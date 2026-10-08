// background-generation.js
// © 2026 Yonatan Eliyahu Lifshitz — AS-IS, personal use only.
//
// Everything "step 2" (background book generation + push notifications)
// added to the app lives in THIS file — not in index.html — so that future
// edits/regenerations of index.html only need to preserve a few small,
// stable hook points (see INTEGRATION-NOTES at the bottom) instead of
// re-merging this whole feature every time.
//
// Loaded in index.html as:
//   <script type="text/babel" src="background-generation.js" data-presets="react"></script>
// placed BEFORE the app's main <script type="text/babel"> tag, so every
// name defined here (functions, the React component) is already available
// as a plain global when the main app script runs — Babel standalone has no
// module system here, everything shares one global scope, same as if this
// were pasted directly into index.html.
//
// This file depends on functions/constants already defined in index.html by
// the time it RUNS (not by the time it's parsed): FALLBACK_CHAIN_ORDER,
// getApiKey, getModel, getCustomBaseUrl, isProviderManuallyDisabled,
// ensureGoogleSignedIn, getCloudEmail, resolveBackupProject,
// identityForProject, hashEmailToDocId, useState, AppIcon, SecondaryButton.
// Since React doesn't render anything until index.html's own script calls
// ReactDOM.render, this is safe even though this file is loaded first.

// TODO: fill in with the real backend URL once deployed (see INTEGRATION.md) —
// e.g. "https://english-books-backend.onrender.com"
const BACKGROUND_JOBS_BACKEND_URL = "https://english-books-backend.onrender.com";
// Gathers this device's provider settings (keys/models/custom Base URLs) in
// the exact shape backend/generation/providerClients.js expects — same
// FALLBACK_CHAIN_ORDER, same per-provider fields.
function collectProviderConfigForBackend() {
  const providers = {};
  for (const id of window.FALLBACK_CHAIN_ORDER) {
    const apiKey = getApiKey(id);
    if (!apiKey) continue;
    providers[id] = { apiKey, model: getModel(id) };
    if (id === "custom" || id === "custom2") providers[id].baseUrl = getCustomBaseUrl(id);
  }
  providers.disabled = window.FALLBACK_CHAIN_ORDER.filter(isProviderManuallyDisabled);
  return providers;
}

// Starts a book generating on the server instead of in this tab. Returns
// the jobId, or throws (e.g. no cloud backup set up yet — background
// generation has nowhere to deliver the finished book without one).
async function startBackgroundBookGeneration({ category, level, avoidTopics, forcedQuery }) {
  if (!BACKGROUND_JOBS_BACKEND_URL) {
    throw new Error("יצירה ברקע עוד לא הוגדרה (חסר כתובת שרת) — פנו למי שהקים את האפליקציה.");
  }
  const providers = collectProviderConfigForBackend();
  if (!Object.keys(providers).some((k) => k !== "disabled")) {
    throw new Error("אין מפתח API מוגדר לאף ספק — אי אפשר ליצור ספר.");
  }

  // Background generation needs a real cloud backup identity to deliver
  // the finished book to — set one up (or reuse the existing one) exactly
  // the way a normal manual backup would, including choosing/creating this
  // reader's pooled project.
  const registryIdentity = await ensureGoogleSignedIn(null, true);
  const email = registryIdentity.email || getCloudEmail();
  const targetConfig = await resolveBackupProject(registryIdentity, null, true);
  const identity = await identityForProject(registryIdentity, targetConfig, null, true);

  const res = await fetch(`${BACKGROUND_JOBS_BACKEND_URL}/api/jobs/generate-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: hashEmailToDocId(email),
      email,
      uid: identity.uid,
      providers,
      bookConfig: { category, level, avoidTopics, forcedQuery },
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `השרת החזיר שגיאה (${res.status}).`);
  }
  return res.json(); // { jobId, targetProjectId }
}

// Registers this device for Web Push notifications ("your book is ready")
// and tells the backend about it. Call from a button tap (permission
// prompts require a user gesture), not automatically on page load.
async function enableBackgroundGenerationNotifications() {
  if (!BACKGROUND_JOBS_BACKEND_URL) throw new Error("יצירה ברקע עוד לא הוגדרה.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("הדפדפן הזה לא תומך בהתראות Push.");
  }
  const reg = await navigator.serviceWorker.register("/push-sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("לא ניתנה הרשאה להתראות.");

  const vapidPublicKey = "BNxg1-2Lc1RehM01VWGa6lsOhMD7Ypum1U07G5Se5wJsCakYWG3cOLYeQ-e5WAWmHQ7nLqQF4GAUTBh7rZMYRh8 "; // TODO: paste the VAPID_PUBLIC_KEY from the backend's .env here (it's meant to be public)
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidPublicKey,
  });

  const registryIdentity = await ensureGoogleSignedIn(null, true);
  const email = registryIdentity.email || getCloudEmail();
  await fetch(`${BACKGROUND_JOBS_BACKEND_URL}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: hashEmailToDocId(email), subscription }),
  });
}

// Lets the reader turn on Web Push notifications for background book
// generation ("your book is ready" — arrives even with the app closed).
// Lives in Settings → "גיבוי ושמירה", next to the cloud-backup controls,
// since background generation delivers its finished book through that
// same backup mechanism (see startBackgroundBookGeneration above).
function BackgroundNotificationsPanel({ state }) {
  const [status, setStatus] = React.useState(null); // null | "working" | "done" | { error }

  const alreadyGranted = typeof Notification !== "undefined" && Notification.permission === "granted";

  async function handleEnable() {
    setStatus("working");
    try {
      await enableBackgroundGenerationNotifications();
      setStatus("done");
    } catch (e) {
      setStatus({ error: e.message || "משהו השתבש." });
    }
  }

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 12,
        border: "1.5px dashed var(--line-strong)",
        background: "var(--paper-raised)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#5c665f", marginBottom: 6 }}>
        התראות ליצירה ברקע
      </div>
      <div style={{ fontSize: 11.5, color: "#5c665f", marginBottom: 8, lineHeight: 1.6 }}>
        כשיוצרים ספר בכפתור "⚡ צור ברקע" בעמוד הבית, הספר נכתב בשרת — אפשר לסגור את האפליקציה, לנעול את המסך ולעבור לדברים אחרים.
        <br />
        אישור ההתראות גורם לכך שברגע שהספר מוכן תקבלו הודעה על המכשיר: "הספר שלך מוכן" — גם אם האפליקציה סגורה לגמרי. לחיצה על ההודעה פותחת את האפליקציה והספר כבר מחכה בספרייה.
        <br />
        בלי התראות הספר ייווצר בכל זאת, ויופיע בספרייה בפעם הבאה שתפתחו את האפליקציה.
      </div>
      <div style={{ fontSize: 11, color: "#7a847d", marginBottom: 8, lineHeight: 1.5 }}>
        הפעלה חד-פעמית בכל מכשיר. באייפון צריך קודם להוסיף את האפליקציה למסך הבית.
      </div>
      {typeof Notification !== "undefined" && Notification.permission === "denied" && status !== "done" ? (
        <div style={{ fontSize: 12, color: "#8B3A3A", lineHeight: 1.5 }}>
          ההתראות חסומות במכשיר הזה. כדי להפעיל: הגדרות הדפדפן/האתר ← התראות ← אפשר, ואז חזרו לכאן.
        </div>
      ) : alreadyGranted && status !== "done" ? (
        <div style={{ fontSize: 12, color: "#3E7C74", fontWeight: 700 }}>✓ הרשאת התראות כבר אושרה במכשיר הזה</div>
      ) : (
        <SecondaryButton onClick={handleEnable} disabled={status === "working"}>
          {status === "working" ? <AppIcon name="Loader2" className="spin" size={14} /> : null}
          הפעלת התראות
        </SecondaryButton>
      )}
      {status === "done" && (
        <div style={{ fontSize: 12, color: "#3E7C74", marginTop: 6, fontWeight: 700 }}>✓ ההתראות הופעלו בהצלחה</div>
      )}
      {status && status.error && (
        <div style={{ fontSize: 12, color: "#8B3A3A", marginTop: 6 }}>{status.error}</div>
      )}
    </div>
  );
}

// The actual "generate via server, with polling + fallback" logic, pulled
// out of the App component so it can live here instead of in index.html.
// index.html keeps only a ~6-line wrapper (see INTEGRATION-NOTES) that
// calls this, passing in the handful of React state setters/refs this
// needs — everything else is unchanged from before the split.
//
// `ctx` fields (all supplied by index.html's thin wrapper):
//   state, setState               — the app's main state + setter
//   activeJobIdsRef                — ref tracking in-flight loading-job ids
//   setLoadingContext, setLoadingNote, removeLoadingJob, finishLoadingSuccess
//                                   — the floating job-progress widget's API
//   setErrorMsg                    — shows an error banner
//   CAT_BY_ID                      — category lookup table
//   blockedByConcurrencyLimit      — the existing "too many jobs at once" guard
//   createNewStory                 — the ORIGINAL in-app generator, used as
//                                     the fallback when no server is
//                                     configured or it can't be reached
async function createNewStoryViaBackendImpl(catId, level, avoidTopics, ctx) {
  const {
    state, setState, activeJobIdsRef, setLoadingContext, setLoadingNote,
    removeLoadingJob, finishLoadingSuccess, setErrorMsg, CAT_BY_ID,
    blockedByConcurrencyLimit, createNewStory,
  } = ctx;

  if (!BACKGROUND_JOBS_BACKEND_URL) {
    await createNewStory(catId, level);
    return;
  }
  const category = CAT_BY_ID[catId];
  if (blockedByConcurrencyLimit(category && category.itemLabel)) return;

  const jobId = `bg-${catId}-${Date.now()}`;
  activeJobIdsRef.current.add(jobId);
  setLoadingContext(jobId, { category, level });

  let serverJobId;
  try {
    const started = await startBackgroundBookGeneration({ category, level, avoidTopics });
    serverJobId = started.jobId;
  } catch (e) {
    activeJobIdsRef.current.delete(jobId);
    removeLoadingJob(jobId);
    // Server unavailable (no connection, no cloud sign-in, server error):
    // don't block the reader — generate in the app as usual.
    console.warn("Background generation unavailable — generating in the app instead:", e);
    await createNewStory(catId, level);
    return;
  }
  setLoadingNote(jobId, "מתחילים ליצור את הספר…", 180);

  const poll = async () => {
    // Reader may have force-closed everything and come back much later —
    // nothing to poll toward in that case, just stop quietly.
    if (!activeJobIdsRef.current.has(jobId)) return;
    try {
      const res = await fetch(`${BACKGROUND_JOBS_BACKEND_URL}/api/jobs/${serverJobId}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "השרת החזיר שגיאה.");

      if (job.status === "running") {
        setLoadingNote(jobId, typeof job.progress === "string" ? job.progress : "יוצרים…");
        setTimeout(poll, 4000);
        return;
      }
      if (job.status === "done") {
        const patch = await pullBackup(state, null, false).catch(() => null);
        if (patch) setState((prev) => mergeBackupPatch(prev, patch));
        activeJobIdsRef.current.delete(jobId);
        finishLoadingSuccess(jobId, { storyId: job.bookId, chapterIndex: 0 }, null);
        return;
      }
      activeJobIdsRef.current.delete(jobId);
      removeLoadingJob(jobId);
      setErrorMsg(job.error || "יצירת הספר נכשלה.");
    } catch (e) {
      activeJobIdsRef.current.delete(jobId);
      removeLoadingJob(jobId);
      setErrorMsg(e.message || "אירעה שגיאה במעקב אחרי היצירה.");
    }
  };
  setTimeout(poll, 4000);
}

// =============================================================================
// INTEGRATION-NOTES — what index.html must keep, so this file can change
// freely without ever needing to touch index.html again:
//
// 1. This script tag, before index.html's own main <script type="text/babel">:
//      <script type="text/babel" src="background-generation.js" data-presets="react"></script>
//
// 2. Inside the App component, this thin wrapper (replaces the old, much
//    longer version of createNewStoryViaBackend — all it does now is hand
//    off to createNewStoryViaBackendImpl above with the local closures it needs):
//      async function createNewStoryViaBackend(catId, level, avoidTopics) {
//        return createNewStoryViaBackendImpl(catId, level, avoidTopics, {
//          state, setState, activeJobIdsRef, setLoadingContext, setLoadingNote,
//          removeLoadingJob, finishLoadingSuccess, setErrorMsg, CAT_BY_ID,
//          blockedByConcurrencyLimit, createNewStory,
//        });
//      }
//
// 3. The two existing call sites that already call createNewStoryViaBackend
//    (in startOrContinue, and in startNextStory) — unchanged, nothing to do.
//
// 4. The JSX line inside SettingsModal's "backup" tab:
//      <BackgroundNotificationsPanel state={state} />
//    — unchanged; it just references a globally available component name,
//    which this file now provides instead of index.html.
//
// That's the whole surface area. Everything else — the backend URL, the
// provider-config collection, the job-starting/polling logic, the push
// subscription flow, the notifications panel's own rendering — lives here.
// =============================================================================
