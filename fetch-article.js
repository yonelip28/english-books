// netlify/functions/fetch-article.js
//
// Server-side fetch proxy for the "ייבוא כתבה מקישור" (import article from
// link) feature in index.html.
//
// WHY THIS EXISTS: a browser's fetch() is subject to CORS — the target site
// has to explicitly opt in with response headers, and most news/magazine
// sites don't. A request made from a server (this function) to another
// server is NOT subject to CORS at all — CORS is purely a browser
// enforcement mechanism. So the app fetches directly first, and only calls
// this function as a fallback when the direct browser fetch fails.
//
// This does exactly what a person copy-pasting the article manually would
// do: load the public page and hand its content back to the app for
// extraction. It does not store, cache, republish, or forward the content
// anywhere else.
//
// PORTABILITY: the client calls the fixed path "/api/fetch-article"
// (see ARTICLE_PROXY_URL in index.html), never this file's real path
// directly. netlify.toml rewrites "/api/*" to "/.netlify/functions/*" so
// that path resolves here on Netlify. If this project ever moves to a
// different host, only the deployment needs to change — see the bottom of
// this file for equivalent Vercel / Cloudflare Pages versions.

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap, plenty for an article page
const FETCH_TIMEOUT_MS = 15000;

// Not exhaustive SSRF protection (a determined attacker could still find a
// route via DNS rebinding etc.), but blocks the obvious cases of someone
// pointing this proxy at internal/loopback/link-local addresses.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

// Two realistic, current desktop-browser header profiles — tried in order.
// This identifies the request as "an ordinary browser visit" (which is what
// this feature is actually standing in for — the app fetches the exact same
// public page a person would get by opening the link themselves), not as
// any special/privileged identity. It never claims to be a specific search
// engine crawler or any other entity with elevated access, and it never
// tries to get past a paywall or login wall — only the plain public HTML a
// logged-out visitor sees either way.
const BROWSER_PROFILES = [
  {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
  },
  {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
  },
];

// Response statuses worth retrying once with the OTHER header profile
// before giving up — typically a site's bot-mitigation rejecting the first
// profile specifically, not a real "this page doesn't exist" situation.
const RETRYABLE_STATUSES = new Set([403, 406, 429, 999]);

const ROBOTS_TIMEOUT_MS = 4000;

// Best-effort, good-citizen check: if the target site's own robots.txt
// disallows crawling this exact path for a general user-agent ("*"), this
// proxy honors that instead of quietly working around it — the whole point
// of asking politely first. Only understands the common, simple
// "User-agent: *" + "Disallow: /path" shape (no wildcards/regex, no
// per-bot-name rules); anything more elaborate, or robots.txt being
// unreachable/slow/absent, is treated as "no objection stated" rather than
// blocking the fetch — this is a courtesy check, not a legal parser.
async function isDisallowedByRobots(target) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(`${target.origin}/robots.txt`, { signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );
    if (!res.ok) return false;
    const body = await res.text();
    let appliesToUs = false;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) {
        appliesToUs = value === "*";
      } else if (appliesToUs && /^disallow$/i.test(key) && value) {
        if (target.pathname.startsWith(value)) return true;
      }
    }
    return false;
  } catch (e) {
    return false; // unreachable/timed out — don't let this block a fetch it can't actually judge
  }
}

async function fetchWithProfile(target, profile, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target.href, { redirect: "follow", signal: controller.signal, headers: profile });
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async (event) => {
  const rawUrl = (event.queryStringParameters && event.queryStringParameters.url) || "";

  let target;
  try {
    target = new URL(rawUrl);
  } catch (e) {
    return jsonError(400, "פרמטר url חסר או לא תקין.");
  }

  if (!/^https?:$/.test(target.protocol)) {
    return jsonError(400, "מותרים רק קישורי http/https.");
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(target.hostname))) {
    return jsonError(400, "כתובת זו אינה נתמכת.");
  }

  if (await isDisallowedByRobots(target)) {
    return jsonError(403, "האתר מבקש (דרך robots.txt) לא לגשת לדף הזה באופן אוטומטי. אפשר להדביק את תוכן הכתבה ידנית.");
  }

  try {
    let res = await fetchWithProfile(target, BROWSER_PROFILES[0], FETCH_TIMEOUT_MS);
    if (RETRYABLE_STATUSES.has(res.status)) {
      // The first profile got specifically blocked (not "page doesn't
      // exist") — one honest retry with the other ordinary-browser profile
      // before giving up, exactly like a person might just try a different
      // browser if one happened to get flagged.
      res = await fetchWithProfile(target, BROWSER_PROFILES[1], FETCH_TIMEOUT_MS);
    }

    if (!res.ok) {
      return jsonError(res.status, `הדף החזיר שגיאה (קוד ${res.status}).`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return jsonError(415, "הקישור אינו מוביל לדף HTML.");
    }

    // Stream-guard against oversized pages instead of buffering everything
    // first — arrayBuffer() is simplest given Netlify Functions' response
    // size limits anyway, so just cap after the fact.
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return jsonError(413, "הדף גדול מדי.");
    }

    const html = Buffer.from(buf).toString("utf-8");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
    };
  } catch (e) {
    const timedOut = e && e.name === "AbortError";
    return jsonError(504, timedOut ? "הבקשה לדף נמשכה יותר מדי זמן." : "לא ניתן היה להביא את הדף.");
  }
};

function jsonError(statusCode, message) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: message }),
  };
}

// ---------------------------------------------------------------------
// EQUIVALENTS FOR OTHER HOSTS (kept here purely for reference — only one
// of these is ever deployed at a time, matching whichever platform the
// project is actually hosted on).
//
// VERCEL — same idea, placed at /api/fetch-article.js in the project root
// (Vercel maps /api/*.js to /api/* automatically, no redirect file needed):
//
//   export default async function handler(req, res) {
//     const rawUrl = req.query.url;
//     // ...same URL validation as above...
//     const upstream = await fetch(target.href, { redirect: "follow" });
//     const html = await upstream.text();
//     res.setHeader("Content-Type", "text/html; charset=utf-8");
//     res.status(200).send(html);
//   }
//
// CLOUDFLARE PAGES — placed at /functions/api/fetch-article.js
// (Cloudflare Pages Functions use this file-path-to-route convention):
//
//   export async function onRequestGet(context) {
//     const url = new URL(context.request.url);
//     const rawUrl = url.searchParams.get("url");
//     // ...same URL validation as above...
//     const upstream = await fetch(target, { redirect: "follow" });
//     return new Response(await upstream.text(), {
//       headers: { "Content-Type": "text/html; charset=utf-8" },
//     });
//   }
//
// In every case the browser-side code in index.html stays exactly the
// same — it only ever calls "/api/fetch-article?url=...".
// ---------------------------------------------------------------------
