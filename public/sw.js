// The server sends the finished sentence (with the person's name) and where to go.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch {}
  const title = d.title || "Herot";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: d.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: d.url || "/notifications" },
      tag: d.kind || "herot",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
      return clients.openWindow(url);
    })
  );
});
