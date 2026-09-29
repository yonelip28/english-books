// push-sw.js
// © 2026 Yonatan Eliyahu Lifshitz — AS-IS, personal use only.
//
// ONLY job of this service worker: wake up when the backend sends a Web
// Push message (e.g. "הספר שלך מוכן") and show a system notification —
// even if the app/tab is fully closed. This is the ONE thing browsers
// genuinely support running "in the background": the OS itself delivers
// the push to the browser, which briefly wakes this file just to call
// showNotification(). It is NOT general-purpose background code — it
// can't run generation logic, only react to a push and display a message.
//
// Deliberately has NO 'fetch' handler and does NO caching, so it can
// never cause the old "stale cached index.html" bug index.html already
// had to work around by unregistering the previous service worker.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'חדר קריאה', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'חדר קריאה';
  const options = {
    body: data.body || 'הספר שלך מוכן.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'he',
    data: { url: data.url || '/' }, // where to open on click
    tag: data.tag || 'book-ready',  // replaces older notifications with same tag
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an existing tab if one is open,
// otherwise opens a new one to the book/library.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// No 'install'/'activate' caching logic on purpose. skipWaiting so a
// pushed update takes effect immediately instead of waiting for all
// tabs to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
