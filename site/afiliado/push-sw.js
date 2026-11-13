// Painel do afiliado: aviso de venda no celular do afiliado. Tocar abre o painel.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || '💰 Venda no Studio Cover!', {
      body: d.body || '', icon: '/afiliado/icon-192.png', badge: '/admin/badge-96.png', data: { url: d.url || '/afiliado/' },
      tag: 'sc-venda-' + Date.now(), renotify: true, silent: false, vibrate: [120, 60, 120, 60, 400],
    }),
    // painel aberto: toca a caixa registradora lá também
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'venda' }))),
  ]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.location.origin + '/afiliado/') && 'focus' in c) return c.focus();
    return self.clients.openWindow('/afiliado/');
  }));
});
