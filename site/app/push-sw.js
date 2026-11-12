// Studio Cover: recebe os avisos no celular (notificação) e abre o app quando a pessoa toca.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Studio Cover', {
    body: d.body || '', icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', data: { url: d.url || '/app/' }, tag: 'sc-aviso', renotify: true,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/app/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.location.origin + '/app/') && 'focus' in c) { if (url.startsWith(self.location.origin + '/app/')) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
