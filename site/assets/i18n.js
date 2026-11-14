/* Studio Cover: línguas do lado do cliente (inglês, francês, português de Portugal, espanhol, alemão, italiano).
   O site é escrito em português do Brasil. Para outra língua, este arquivo troca os textos da página pelo dicionário
   /assets/i18n/<lingua>.json (chave = texto em português). Em português (Brasil) não faz nada, então a versão
   brasileira nunca muda. Textos que faltam no dicionário são avisados ao servidor (/api/i18n.php) para traduzir. */
(function () {
  'use strict';
  var V = 156639518; // sobe quando os dicionários mudam (tools/i18n-montar.mjs atualiza sozinho)
  var LANGS = { pt: 'Português (Brasil)', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', 'pt-pt': 'Português (Portugal)' };
  var HTMLLANG = { pt: 'pt-BR', en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', 'pt-pt': 'pt-PT' };
  var BR_TZ = /^America\/(Sao_Paulo|Fortaleza|Recife|Bahia|Manaus|Belem|Cuiaba|Campo_Grande|Porto_Velho|Boa_Vista|Rio_Branco|Araguaina|Maceio|Santarem|Noronha|Eirunepe)$/;
  var PT_TZ = /^(Europe\/Lisbon|Atlantic\/Azores|Atlantic\/Madeira)$/;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function cookie(k) { var m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function norm(l) { l = String(l || '').toLowerCase().replace('_', '-'); if (l === 'pt-br') return 'pt'; if (LANGS[l]) return l; var b = l.split('-')[0]; return LANGS[b] ? b : ''; }
  // página de anúncio de fora: /us (só inglês) ou /eu (bandeirinhas en/es/fr/pt-pt). Fica gravado no navegador (sc_reg_fix).
  var EU_LANGS = ['en', 'es', 'fr', 'pt-pt'];
  var FIX = (function () {
    var r = ''; try { r = (new URLSearchParams(location.search).get('reg') || '').toLowerCase(); } catch (e) {}
    if (r === 'br') { document.cookie = 'sc_reg_fix=; path=/; max-age=0'; ls('sc-reg-fix', null); return ''; }
    if (r === 'us' || r === 'eu') return r;
    r = cookie('sc_reg_fix') || ls('sc-reg-fix') || '';
    return r === 'us' || r === 'eu' ? r : '';
  })();
  function detect() {
    var q = ''; try { q = new URLSearchParams(location.search).get('lang') || ''; } catch (e) {}
    if (FIX === 'us') return 'en';
    if (FIX === 'eu') {
      var e = [norm(q), norm(cookie('sc_lang')), norm(ls('sc-lang'))].filter(function (x) { return EU_LANGS.indexOf(x) >= 0; })[0];
      if (e) return e;
      var nv = String((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
      if (nv.indexOf('es') === 0) return 'es'; if (nv.indexOf('fr') === 0) return 'fr'; if (nv.indexOf('pt') === 0) return 'pt-pt';
      return 'en';
    }
    var l = norm(q) || norm(cookie('sc_lang')) || norm(ls('sc-lang'));
    if (l) return l;
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (BR_TZ.test(tz)) return 'pt'; // no Brasil é sempre português, mesmo com o celular em outra língua
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    var n = String(nav).toLowerCase();
    if (n === 'pt-pt' || (n.indexOf('pt') === 0 && PT_TZ.test(tz))) return 'pt-pt';
    if (n.indexOf('pt') === 0) return 'pt';
    if (!n) return 'pt';
    return norm(n) || 'en';
  }
  var lang = detect();
  // região (preço e checkout): Brasil, Estados Unidos/Canadá ou Europa, pelo fuso horário do aparelho
  function regiao(l) {
    if (FIX) return FIX;
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (BR_TZ.test(tz)) return 'br';
    if (/^(Europe|Atlantic\/(Azores|Madeira|Canary|Reykjavik|Faroe))\//.test(tz)) return 'eu';
    if (/^(America|US|Canada|Pacific\/Honolulu)\//.test(tz)) return l === 'pt' ? 'br' : 'us';
    return l === 'pt' ? 'br' : (l === 'en' ? 'us' : 'eu');
  }
  function ck(k, v) { var exp = new Date(Date.now() + 365 * 864e5).toUTCString(); document.cookie = k + '=' + v + '; path=/; expires=' + exp + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); }
  function save(l, escolheu) { ck('sc_lang', l); ck('sc_reg', regiao(l)); if (FIX) { ck('sc_reg_fix', FIX); ls('sc-reg-fix', FIX); } if (escolheu) ck('sc_lang_escolhida', '1'); ls('sc-lang', l); }
  save(lang);
  var api = window.scI18n = { lang: lang, regiao: regiao(lang), fix: FIX, langs: LANGS, ready: null, t: function (s) { return s; }, set: function (l) { l = norm(l) || 'pt'; if (FIX === 'us') l = 'en'; if (FIX === 'eu' && EU_LANGS.indexOf(l) < 0) l = 'en'; save(l, true); try { var u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.toString()); } catch (e) { location.reload(); } } };
  document.documentElement.setAttribute('data-lang', lang);
  if (lang === 'pt') { api.ready = Promise.resolve(); switcherLater(); return; }
  document.documentElement.lang = HTMLLANG[lang];

  // esconde a página até traduzir (no máximo 2,5 s) para a pessoa não ver o português piscando
  var st = document.createElement('style'); st.textContent = 'html.i18n-wait body{visibility:hidden!important}'; (document.head || document.documentElement).appendChild(st);
  document.documentElement.classList.add('i18n-wait');
  var shown = false; function show() { if (shown) return; shown = true; document.documentElement.classList.remove('i18n-wait'); }
  setTimeout(show, 2500);

  var DICT = null, PATS = [], VALS = {}, miss = {}, missN = 0;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1, TEMPLATE: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1 };
  var INLINE = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SMALL: 1, MARK: 1, SUP: 1, SUB: 1, BR: 1, S: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-help'];
  function nz(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); }
  function escA(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  // forma única de escrever o HTML de dentro de um elemento (a mesma no extrator e no PHP dos e-mails)
  function canon(el) {
    var out = '';
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += esc(c.nodeValue);
      else if (c.nodeType === 1) {
        var t = c.tagName.toLowerCase(), a = '';
        for (var i = 0; i < c.attributes.length; i++) a += ' ' + c.attributes[i].name + '="' + escA(c.attributes[i].value) + '"';
        out += t === 'br' ? '<br' + a + '>' : '<' + t + a + '>' + canon(c) + '</' + t + '>';
      }
    }
    return out;
  }
  function richLeaf(el) { // só texto e negrito/itálico/quebra dentro, sem id (para não estragar o que o app guarda)
    var inl = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) { if (!INLINE[c.tagName] || c.id || (c.tagName !== 'BR' && !richLeaf2(c))) return false; inl = true; }
    }
    return inl;
  }
  function richLeaf2(el) { for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!INLINE[c.tagName] || c.id || !richLeaf2(c))) return false; return true; }
  var hasLetters = /[A-Za-zÀ-ÿ]/;
  function lookup(k) {
    if (!k || !hasLetters.test(k)) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
    for (var i = 0; i < PATS.length; i++) {
      var p = PATS[i]; if (k.indexOf(p.hint) < 0) continue;
      var m = p.re.exec(k); if (!m) continue;
      return p.v.replace(/\{(\d+)\}/g, function (_, n) { var g = m[+n + 1]; if (g == null) return ''; var gt = nz(g); var tr = Object.prototype.hasOwnProperty.call(DICT, gt) ? DICT[gt] : null; return tr != null ? tr : g; });
    }
    return null;
  }
  var PT = /[ãõçáéíóúâêôà]|\b(você|não|para|com|seu|sua|vídeo|voz|que|uma|um|do|da|dos|das|no|na|em|de|ao|pelo|pela|mais|agora|toque|aqui|fazer|está|isso|então)\b/i;
  function noteMiss(k) {
    if (missN > 300 || miss[k] || VALS[k] || k.length > 600 || !PT.test(k) || /[▮▯▓▒░]/.test(k) || /^\S+\.\S+$/.test(k)) return;
    miss[k] = 1; missN++; clearTimeout(noteMiss.t); noteMiss.t = setTimeout(sendMiss, 4000);
  }
  function sendMiss() {
    var l = Object.keys(miss).filter(function (k) { return miss[k] === 1; }); if (!l.length) return;
    l.forEach(function (k) { miss[k] = 2; });
    try { fetch('/api/i18n.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: lang, pagina: location.pathname, textos: l.slice(0, 60) }), keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function trText(n) {
    var v = n.nodeValue; if (!v || !hasLetters.test(v)) return;
    var k = nz(v), r = lookup(k);
    if (r == null) { noteMiss(k); return; }
    var lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
    var nv = lead + r + tail; if (nv !== v) n.nodeValue = nv;
  }
  function trAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]); if (!a) continue;
      var r = lookup(nz(a)); if (r != null && r !== a) el.setAttribute(ATTRS[i], r); else if (r == null) noteMiss(nz(a));
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { var rv = lookup(nz(el.value)); if (rv != null) el.value = rv; }
  }
  function skip(el) { return SKIP[el.tagName] || el.hasAttribute('data-noi18n') || el.getAttribute('translate') === 'no' || (el.classList && el.classList.contains('notranslate')); }
  function walk(node) {
    if (node.nodeType === 3) { if (node.parentNode && node.parentNode.nodeType === 1 && skip(node.parentNode)) return; return trText(node); }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (skip(node)) { if (node.tagName === 'TEXTAREA' && !node.hasAttribute('data-noi18n')) trAttrs(node); return; }
      trAttrs(node);
      if (richLeaf(node)) {
        var k = nz(canon(node));
        if (hasLetters.test(k)) { var r = lookup(k); if (r != null) { if (r !== k) node.innerHTML = r; return; } }
      }
    }
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }
  function compile(d) {
    DICT = {}; PATS = [];
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      var v = d[k]; if (typeof v !== 'string' || v === '') continue; VALS[v] = 1;
      if (/\{\d+\}/.test(k)) {
        var parts = k.split(/\{\d+\}/), hint = parts.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
        if (nz(hint).length < 3) continue;
        var re = '^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, '([\\s\\S]+?)') + '$';
        try { PATS.push({ re: new RegExp(re), hint: hint, v: v }); } catch (e) {}
      } else DICT[k] = v;
    }
    PATS.sort(function (a, b) { return b.hint.length - a.hint.length; });
  }
  api._ = { miss: miss,  canon: canon, richLeaf: richLeaf, nz: nz, skip: skip, ATTRS: ATTRS };
  api.t = function (s) { if (!DICT || s == null) return s; var r = lookup(nz(s)); if (r == null) { noteMiss(nz(s)); return s; } return r; };
  // janelas do navegador (alert/confirm/prompt) também
  ['alert', 'confirm', 'prompt'].forEach(function (f) { var o = window[f]; if (!o) return; window[f] = function (msg) { var a = [].slice.call(arguments); a[0] = api.t(msg); return o.apply(window, a); }; });
  var titleSet = false;
  function translateTitle() { if (document.title) { var r = lookup(nz(document.title)); if (r != null && r !== document.title) document.title = r; } }
  function start() {
    walk(document.body || document.documentElement); translateTitle();
    var md = document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]');
    for (var i = 0; i < md.length; i++) { var r = lookup(nz(md[i].content)); if (r != null) md[i].content = r; }
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') { if (m.target.nodeType === 1) trAttrs(m.target); }
        else {
          if (m.target.nodeType === 1 && !skip(m.target) && richLeaf(m.target)) { walk(m.target); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    var tEl = document.querySelector('title'); if (tEl) new MutationObserver(translateTitle).observe(tEl, { childList: true, characterData: true, subtree: true });
    show(); switcherLater();
  }
  var key = 'sc-i18n-' + lang, cached = null;
  try { cached = JSON.parse(ls(key) || 'null'); } catch (e) {}
  function onDom(f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); }
  api.ready = new Promise(function (res) {
    if (cached && cached.v === V) { compile(cached.d); onDom(function () { start(); res(); }); return; }
    fetch('/assets/i18n/' + lang + '.json?v=' + V).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      compile(d); try { ls(key, JSON.stringify({ v: V, d: d })); } catch (e) {}
      onDom(function () { start(); res(); });
    }).catch(function () { show(); res(); });
  });

  // seletor de língua: no rodapé das páginas (qualquer elemento com data-lang-switch, ou o <footer>)
  function switcherLater() { onDom2(function () { setTimeout(switcher, 0); }); }
  function onDom2(f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); }
  // bandeirinhas (só Europa): desenhadas aqui mesmo, sem emoji, para aparecer igual em qualquer celular
  var FLAGS = {
    en: '<svg viewBox="0 0 60 30" width="30" height="20" preserveAspectRatio="none"><clipPath id="scuk"><path d="M0 0v30h60V0z"/></clipPath><g clip-path="url(#scuk)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>',
    es: '<svg viewBox="0 0 3 2" width="30" height="20"><rect width="3" height="2" fill="#AA151B"/><rect y=".5" width="3" height="1" fill="#F1BF00"/></svg>',
    fr: '<svg viewBox="0 0 3 2" width="30" height="20"><rect width="1" height="2" fill="#002654"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#CE1126"/></svg>',
    'pt-pt': '<svg viewBox="0 0 5 3" width="30" height="20"><rect width="5" height="3" fill="#FF0000"/><rect width="2" height="3" fill="#006600"/><circle cx="2" cy="1.5" r=".6" fill="#FFCC00"/></svg>'
  };
  var FLAG_NAME = { en: 'English', es: 'Español', fr: 'Français', 'pt-pt': 'Português' };
  function flags() {
    if (/^\/admin/.test(location.pathname) || document.querySelector('.sc-flags')) return;
    var host = document.querySelector('[data-lang-flags]');
    var bar = document.createElement('div'); bar.className = 'sc-flags'; bar.setAttribute('data-noi18n', ''); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Language');
    // faixa fina no topo da página (não fica por cima de nenhum botão)
    bar.style.cssText = host ? 'display:flex;gap:6px;justify-content:center;margin:10px auto' : 'position:relative;z-index:1;display:flex;gap:10px;justify-content:center;align-items:center;padding:calc(6px + env(safe-area-inset-top,0px)) 8px 6px;background:#000;border-bottom:1px solid rgba(255,214,0,.25)';
    EU_LANGS.forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button'; b.innerHTML = FLAGS[l]; b.title = FLAG_NAME[l]; b.setAttribute('aria-label', FLAG_NAME[l]);
      b.style.cssText = 'all:unset;cursor:pointer;display:block;line-height:0;border-radius:3px;overflow:hidden;width:30px;height:20px;outline:2px solid ' + (l === lang ? '#FFD600' : 'transparent') + ';outline-offset:1px;opacity:' + (l === lang ? '1' : '.8');
      b.onclick = function () { if (l !== lang) api.set(l); };
      bar.appendChild(b);
    });
    if (host) { host.appendChild(bar); return; }
    document.body.insertBefore(bar, document.body.firstChild);
    // no app, o painel de afinação abre em tela cheia: a faixa some enquanto ele está aberto
    var st = document.createElement('style'); st.textContent = 'body:has(.popopen) > .sc-flags{display:none!important}'; document.head.appendChild(st);
    // se a página tem cabeçalho grudado no topo, ele desce a altura da faixa para nada ficar escondido
    var h = bar.offsetHeight;
    [].forEach.call(document.querySelectorAll('body > header, body > .top, body > .topo, body > nav, header.top'), function (el) {
      var cs = getComputedStyle(el); if ((cs.position === 'fixed' || cs.position === 'sticky' || cs.position === 'absolute') && parseFloat(cs.top || '0') < 4) el.style.top = h + 'px';
    });
  }
  function switcher() {
    if (FIX === 'us') return;
    if (FIX === 'eu') return flags();
    if (/^\/(admin|app)/.test(location.pathname)) return;
    var host = document.querySelector('[data-lang-switch]') || document.querySelector('footer');
    if (!host || host.querySelector('.sc-lang')) return;
    var s = document.createElement('select'); s.className = 'sc-lang'; s.setAttribute('data-noi18n', ''); s.setAttribute('aria-label', 'Language');
    s.style.cssText = 'margin:14px auto 0;display:block;background:transparent;color:inherit;border:1px solid currentColor;border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;opacity:.75;max-width:220px';
    Object.keys(LANGS).forEach(function (l) { var o = document.createElement('option'); o.value = l; o.textContent = LANGS[l]; if (l === lang) o.selected = true; s.appendChild(o); });
    s.onchange = function () { api.set(s.value); };
    host.appendChild(s);
  }
})();
