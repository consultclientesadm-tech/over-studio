// Central de comando do Studio Cover: aviso de venda no celular do sócio. Tocar abre o painel.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  // som ligado ou desligado no painel (botão Som ligado / Som desligado): a notificação chega sempre, o som só se estiver ligado
  const somLigado = caches.open('sc-adm').then((c) => c.match('/admin/__som')).then((r) => (r ? r.text() : '1')).then((v) => v !== '0').catch(() => true);
  e.waitUntil(somLigado.then((som) => Promise.all([
    self.registration.showNotification(d.title || '💰 Mais uma venda do Studio Cover!', {
      body: d.body || '', icon: '/admin/icon-192.png', badge: '/admin/badge-96.png', data: { url: d.url || '/admin/' },
      tag: 'sc-venda-' + Date.now(), renotify: true, silent: !som, vibrate: som ? [120, 60, 120, 60, 400] : [],
    }),
    // painel aberto: toca a caixa registradora lá também
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'venda' }))),
  ])));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.location.origin + '/admin/') && 'focus' in c) return c.focus();
    return self.clients.openWindow('/admin/');
  }));
});
