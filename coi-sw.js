// Service worker do Studio Cover: liga o "isolamento entre origens" (COOP/COEP) só nesta pasta.
// Com ele o navegador libera vários núcleos do processador para a IA que separa a voz (fica 2 a 4x mais rápido).
// O resto do site (pixel, checkout) não passa por aqui.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
const MOBILE = /iPhone|iPad|iPod|Android|Mobile/i.test(self.navigator.userAgent || '');
if (MOBILE) self.addEventListener('activate', () => self.registration.unregister());
self.addEventListener('fetch', (e) => {
  if (MOBILE) return;
  const r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  const sameOrigin = new URL(r.url).origin === self.location.origin;
  e.respondWith(
    fetch(r).then((res) => {
      if (res.status === 0) return res; // resposta opaca: não dá para mexer
      const h = new Headers(res.headers);
      // a página e os workers da IA precisam dos dois cabeçalhos (sem eles o worker nem nasce)
      if (r.mode === 'navigate' || /worker/.test(r.destination)) { h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); }
      if (sameOrigin) h.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch((err) => { if (r.mode === 'navigate') throw err; return fetch(r); })
  );
});
