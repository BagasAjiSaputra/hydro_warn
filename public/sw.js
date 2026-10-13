// HydroWarn Service Worker - PWA & Push Notification Handler

self.addEventListener("install", (event) => {
  // Activate worker immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || "🚨 PERINGATAN ALARM KEBAKARAN!";
  const options = {
    body: data.body || "Sistem mendeteksi bahaya kebakaran! Segera periksa lokasi.",
    icon: data.icon || "/icons/icon-192x192.png",
    badge: data.badge || "/icons/icon-192x192.png",
    tag: data.tag || "hydrowarn-fire-alert",
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: data.vibrate || [500, 200, 500, 200, 500, 200, 500],
    data: data.data || { url: "/" },
    actions: [
      {
        action: "view",
        title: "Buka Monitor",
      },
      {
        action: "close",
        title: "Tutup",
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "close") {
    return;
  }

  const urlToOpen = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
