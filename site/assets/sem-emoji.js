/* Studio Cover: troca os emojis das telas (painel, afiliado, obrigado, depoimento) pelos ícones da marca (icons.js).
   Não mexe no que a pessoa escreveu (.raw), nem nas estrelas da nota, nem em campos de texto. */
(function () {
  if (!window.ic) return;
  var M = {
    '💰': 'money', '💵': 'money', '💸': 'money', '💳': 'money', '🛒': 'cart',
    '🛰': 'radar', '📍': 'pin', '🧭': 'pin', '💬': 'chat', '🗣': 'chat', '🤝': 'users', '👥': 'users',
    '⛨': 'shield', '🛡': 'shield', '⚖': 'shield', '⚙': 'sliders', '🔧': 'sliders', '☰': 'menu',
    '📣': 'mega', '🔗': 'link', '🔔': 'bell', '🔕': 'belloff', '📵': 'belloff', '🎟': 'ticket', '🎫': 'ticket',
    '🔒': 'lock', '🔑': 'lock', '🎁': 'gift', '⚡': 'bolt', '🚀': 'rocket', '✉': 'mail', '📬': 'mail', '📤': 'mail', '📨': 'mail',
    '✅': 'check', '✓': 'check', '✔': 'check', '❌': 'close', '✕': 'close', '🚫': 'close', '⛔': 'close',
    '⚠': 'warn', '🎯': 'orig', '🎬': 'video', '🎥': 'video', '📷': 'video', '🤳': 'phone', '🔁': 'redo',
    '📅': 'calendar', '🖱': 'tap', '👆': 'tap', '👁': 'eye', '👀': 'eye', '🔊': 'spk', '🔈': 'spk',
    '📲': 'install', '📱': 'phone', '📈': 'chart', '📊': 'chart', '🆕': 'plus', '💛': 'heart',
    '⏳': 'clock', '⏱': 'clock', '🧬': 'pulse', '🩺': 'pulse', '⬇': 'download', '📦': 'box', '❔': 'help',
    '📜': 'doc', '📄': 'doc', '🎙': 'mic', '🎤': 'mic', '🎧': 'spk', '🖼': 'image', '💡': 'bulb', '🧠': 'bulb', '✍': 'pen', '✨': 'auto'
  };
  var LED = { '🔴': 'r', '🟡': 'y', '🟢': 'g' };
  // risos, festa e afins: só enfeite, somem
  var FORA = /[\u{1F600}-\u{1F64F}\u{1F389}\u{1F38A}\u{1F44F}\u{1F64F}\u{1F525}\u{1F4AA}]/u;
  var RE = /(\p{Extended_Pictographic}|[✓✕✔])️?(‍\p{Extended_Pictographic}️?)*/gu;
  var PULA = ',SCRIPT,STYLE,TEXTAREA,INPUT,CODE,PRE,OPTION,TITLE,SVG,';
  function trocaNo(t) {
    var v = t.nodeValue; if (!v || !RE.test(v)) return; RE.lastIndex = 0;
    var p = t.parentElement; if (!p || PULA.indexOf(',' + p.tagName + ',') >= 0 || p.closest('.raw,.estrelas,[contenteditable],svg')) return;
    var f = document.createDocumentFragment(), last = 0, m;
    while ((m = RE.exec(v))) {
      if (m.index > last) f.appendChild(document.createTextNode(v.slice(last, m.index)));
      var e = m[0].replace(/️/g, ''), b = e.charAt(0) === '✓' || e.charAt(0) === '✕' || e.charAt(0) === '✔' ? e.charAt(0) : String.fromCodePoint(e.codePointAt(0));
      if (LED[b]) { var s = document.createElement('i'); s.className = 'led-e ' + LED[b]; f.appendChild(s); }
      else if (M[b]) { var i = document.createElement('i'); i.className = 'ic-e'; i.innerHTML = window.ic(M[b]); f.appendChild(i); }
      else if (b === '★' || !FORA.test(b)) { if (b === '★') f.appendChild(document.createTextNode(b)); }
      last = m.index + m[0].length;
    }
    if (last < v.length) f.appendChild(document.createTextNode(v.slice(last)));
    // tira o espaço que sobrava logo depois do emoji no começo do texto
    p.replaceChild(f, t);
  }
  function varre(root) {
    if (!root) return;
    if (root.nodeType === 3) return trocaNo(root);
    if (root.nodeType !== 1 || (root.closest && root.closest('.raw'))) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), L = [], n;
    while ((n = w.nextNode())) if (RE.test(n.nodeValue)) { RE.lastIndex = 0; L.push(n); }
    RE.lastIndex = 0; L.forEach(trocaNo);
    if (root.querySelectorAll) root.querySelectorAll('i[data-ic]:not([data-done])').forEach(function (el) { el.innerHTML = window.ic(el.getAttribute('data-ic')); el.setAttribute('data-done', ''); });
  }
  function liga() {
    varre(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === 'characterData') trocaNo(m.target); else m.addedNodes.forEach(varre); }); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga); else liga();
})();
