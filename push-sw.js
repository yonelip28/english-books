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
  event.waitUntil(
    (async () => {
      const icon = (await makeTopicIcon(data.color)) || "/icon-192.png";
      await self.registration.showNotification(data.title || "הספר שלך מוכן 📖", {
        body: data.body || "הספר שביקשת נוצר ומחכה לך בספרייה.",
        icon,
        badge: "/icon-192.png",
        dir: "rtl",
        lang: "he",
        tag: data.tag || "book-ready",
        data: { url: data.url || "/" },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
