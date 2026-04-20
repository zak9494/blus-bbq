/* ===== SERVICE WORKER — Blu's BBQ Push Notifications =====
   Handles: push events (show notification), notificationclick (open URL)
   Compatible with iOS 16.4+ Safari Web Push (requires PWA add-to-home-screen).
   ===== */
'use strict';

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = {
      title: "Blu's BBQ",
      body: event.data ? event.data.text() : 'New notification',
    };
  }

  var title   = data.title || "Blu's BBQ Dashboard";
  var options = {
    body:       data.body || '',
    icon:       '/White_Logo.png',
    badge:      '/White_Logo.png',
    data:       { url: data.url || '/' },
    vibrate:    [200, 100, 200],
    tag:        data.tag || 'blus-notif',
    renotify:   !!(data.tag),
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wcs) {
      for (var i = 0; i < wcs.length; i++) {
        var c = wcs[i];
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
