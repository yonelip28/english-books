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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(target.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // A generic browser-like UA — some sites block requests with no
        // UA at all, or one that clearly identifies a script/bot.
        "User-Agent":
          "Mozilla/5.0 (compatible; ReadingRoomArticleImport/1.0; +personal reading app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

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
  } finally {
    clearTimeout(timeout);
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
