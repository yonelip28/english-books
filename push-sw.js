// push-sw.js — Service Worker for "your book is ready" push notifications.
// Must be served from the site root (same folder as index.html).
// It does NO caching on purpose (the old caching worker caused stale-page bugs).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Android/Chrome don't let a web notification choose its own accent colour,
// so the topic colour is carried by the notification's picture: the app logo
// on a tile in the topic's colour. If anything goes wrong we just use the
// plain logo — the notification itself is never blocked by this.
async function makeTopicIcon(color) {
  try {
    if (!color || typeof OffscreenCanvas === "undefined") return null;
    const res = await fetch("/icon-192.png");
    const bmp = await createImageBitmap(await res.blob());
    const S = 192;
    const canvas = new OffscreenCanvas(S, S);
    const g = canvas.getContext("2d");
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    const pad = 20, size = S - pad * 2, r = 26;
    g.beginPath();
    g.moveTo(pad + r, pad);
    g.arcTo(pad + size, pad, pad + size, pad + size, r);
    g.arcTo(pad + size, pad + size, pad, pad + size, r);
    g.arcTo(pad, pad + size, pad, pad, r);
    g.arcTo(pad, pad, pad + size, pad, r);
    g.closePath();
    g.clip();
    g.drawImage(bmp, pad, pad, size, size);
    const out = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "data:image/png;base64," + btoa(bin);
  } catch (e) {
    return null;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const isProgress = data.kind === "progress";
  event.waitUntil(
    (async () => {
      const tag = data.tag || "book-ready";
      if (isProgress) {
        // Live "writing… 42%" updates are only for when the app is NOT on screen.
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (wins.some((c) => c.visibilityState === "visible")) {
          // The app is on screen, so no progress notification is wanted. Chrome still
          // expects every push to end in a notification, so show a silent one and
          // remove it straight away (this also clears an older progress notification).
          try {
            await self.registration.showNotification(data.title || "חדר קריאה", {
              tag,
              silent: true,
              icon: "/icon-192.png",
              badge: "/badge-96.png",
              data: { kind: "progress" },
            });
            const open = await self.registration.getNotifications({ tag });
            open.forEach((n) => n.close());
          } catch (e) { /* nothing to clean up */ }
          return;
        }
      }
      const icon = (await makeTopicIcon(data.color)) || "/icon-192.png";
      await self.registration.showNotification(data.title || "הספר שלך מוכן 📖", {
        body: data.body || "הספר שביקשת נוצר ומחכה לך בספרייה.",
        icon,
        badge: "/badge-96.png", // monochrome white-on-transparent: Android shows it in the status bar
        dir: "rtl",
        lang: "he",
        // Same tag for the progress updates and the final "ready" message: the
        // phone replaces the notification in place instead of stacking new ones.
        tag,
        // Progress updates are silent; the final message alerts (sound/vibration).
        silent: isProgress,
        renotify: !isProgress,
        data: { url: data.url || "/", kind: data.kind || "done" },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  const bookId = target.searchParams.get("book");
  const chapterParam = target.searchParams.get("chapter");
  const chapter = chapterParam !== null && chapterParam !== "" && !isNaN(Number(chapterParam)) ? Number(chapterParam) : undefined;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // The app is already open somewhere: bring it to the front and tell it which
      // book to open. (If it is closed, the new window opens on /?book=ID instead.)
      for (const c of list) {
        if ("focus" in c) {
          if (bookId) c.postMessage({ type: "bg-open-book", bookId, chapter });
          return c.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
