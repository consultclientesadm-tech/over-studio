// Botão "Voltar ao app" nas páginas que a pessoa abre de dentro do app (afiliados, termos, oferta...).
// Regra do Leo: nenhuma tela pode obrigar a fechar o app para voltar. Aparece quando a página veio do app
// (link com de=app / utm_source=app, referrer /app/ ou app instalado na tela de início) e vale para as páginas seguintes da mesma visita.
(function () {
  var q = location.search, de = /[?&](de|utm_source)=app\b/.test(q) || /\/app\//.test(document.referrer || '');
  var inst = false; try { inst = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) {}
  try { if (de) sessionStorage.setItem('sc-de-app', '1'); de = de || sessionStorage.getItem('sc-de-app') === '1'; } catch (e) {}
  if (!de && !inst) return;
  function pinta() {
    if (document.getElementById('scVoltarApp')) return;
    var st = document.createElement('style');
    st.textContent = '#scVoltarApp{position:fixed;z-index:99999;left:max(12px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 15px 0 11px;border-radius:999px;background:linear-gradient(180deg,#ffe14d,#f2c200);color:#000;font:800 13px "Space Grotesk",system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 0 #9a7a00,0 6px 18px rgba(0,0,0,.5)}#scVoltarApp svg{width:17px;height:17px}body{padding-top:calc(54px + env(safe-area-inset-top))!important}@media print{#scVoltarApp{display:none}}';
    document.head.appendChild(st);
    var a = document.createElement('a'); a.id = 'scVoltarApp'; a.href = '/app/';
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Voltar ao app';
    a.setAttribute('aria-label', 'Voltar ao app Studio Cover');
    document.body.appendChild(a);
  }
  if (document.body) pinta(); else document.addEventListener('DOMContentLoaded', pinta);
})();
