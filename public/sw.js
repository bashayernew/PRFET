// The server sends the finished sentence (with the person's name) and where to go.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch {}
  const title = d.title || "PRFET";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: d.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: d.url || "/notifications" },
      tag: d.kind || "prfet",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        try {
          // reuse a tab only when it's on the same origin as the target URL
          if (new URL(c.url).origin === new URL(url, c.url).origin && "focus" in c) {
            return c.navigate(url).then(() => c.focus());
          }
        } catch (e) { /* ignore */ }
      }
      return clients.openWindow(url);
    })
  );
});
