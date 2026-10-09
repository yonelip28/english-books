// push-sw.js — Service Worker for "your book is ready" push notifications.
// Must be served from the site root (same folder as index.html).
// It does NO caching on purpose (the old caching worker caused stale-page bugs).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "הספר שלך מוכן 📖";
  const options = {
    body: data.body || "הספר שביקשת נוצר ומחכה לך בספרייה.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "he",
    tag: data.tag || "book-ready",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
