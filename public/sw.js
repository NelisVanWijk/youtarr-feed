self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Youtarr Feed";
  const options = {
    body: payload.body || "New video available.",
    icon: payload.icon || "/icon-512.png",
    badge: payload.badge || "/apple-touch-icon.png",
    image: payload.image,
    tag: payload.tag || "youtarr-feed",
    data: {
      url: payload.url || "/",
      videoId: payload.videoId,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      "setAppBadge" in navigator && payload.badgeCount
        ? navigator.setAppBadge(payload.badgeCount).catch(() => undefined)
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin
  ).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) {
              await client.navigate(targetUrl);
            }
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});
