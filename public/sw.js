self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
    tag: payload.tag || "youtarr-feed",
    renotify: true,
    silent: false,
    data: {
      url: payload.url || "/",
      videoId: payload.videoId,
      videoTitle: payload.videoTitle || payload.title,
      channelId: payload.channelId,
      channelName: payload.channelName,
    },
  };
  if (payload.image) {
    options.image = payload.image;
  }
  options.actions = [
    ...(payload.downloadable
      ? [{ action: "download", title: "Download" }]
      : []),
    ...(payload.channelId
      ? [{ action: "mute-channel", title: "Mute channel" }]
      : []),
  ].slice(0, 2);

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
  event.preventDefault();
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === "download") {
    event.waitUntil(
      fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: data.videoId, channelId: data.channelId }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Download could not be started");
          await self.registration.showNotification("Download started", {
            body: data.videoTitle || "The video was sent to Youtarr.",
            icon: "/icon-512.png",
            badge: "/apple-touch-icon.png",
            tag: `download-${data.videoId || Date.now()}`,
            data: { url: data.url || "/?view=local" },
          });
        })
        .catch(() =>
          self.registration.showNotification("Download failed", {
            body: data.videoTitle || "Open Youtarr Feed to try again.",
            icon: "/icon-512.png",
            badge: "/apple-touch-icon.png",
            tag: `download-error-${data.videoId || Date.now()}`,
            data: { url: data.url || "/" },
          })
        )
    );
    return;
  }
  if (event.action === "mute-channel") {
    event.waitUntil(
      fetch("/api/notifications/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: data.channelId,
          channelName: data.channelName,
          muted: true,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Channel could not be muted");
          await self.registration.showNotification("Channel muted", {
            body: `No more new-video alerts from ${
              data.channelName || "this channel"
            }.`,
            icon: "/icon-512.png",
            badge: "/apple-touch-icon.png",
            tag: `muted-${data.channelId || Date.now()}`,
            data: { url: "/?settings=notifications" },
          });
        })
        .catch(() =>
          self.registration.showNotification("Could not mute channel", {
            body: "Open notification settings to try again.",
            icon: "/icon-512.png",
            badge: "/apple-touch-icon.png",
            tag: `mute-error-${data.channelId || Date.now()}`,
            data: { url: "/?settings=notifications" },
          })
        )
    );
    return;
  }
  const targetUrl = new URL(
    data.url || "/",
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
