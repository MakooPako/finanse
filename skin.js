/* Skórka wyglądu – zapamiętana osobno na każdym urządzeniu (localStorage „finanse.skin”).
   Ładowana w <head> przed resztą strony, żeby nie mignął zły motyw. Domyślnie: klasyczny. */
(function () {
  var FONT = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap';
  var BAR = { classic: '#0d1420', neon: '#07070c' };
  function apply(s) {
    if (s !== 'neon') s = 'classic';
    var d = document.documentElement;
    if (s === 'classic') d.removeAttribute('data-skin'); else d.setAttribute('data-skin', s);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[s]);
    if (s === 'neon' && !document.getElementById('skinFont')) {
      var l = document.createElement('link'); l.id = 'skinFont'; l.rel = 'stylesheet'; l.href = FONT;
      document.head.appendChild(l);
    }
    return s;
  }
  var saved = 'classic';
  try { saved = localStorage.getItem('finanse.skin') || 'classic'; } catch (e) { /* bez pamięci przeglądarki: klasyczny */ }
  window.SKIN = apply(saved);
  window.setSkin = function (v) {
    window.SKIN = apply(v);
    try { localStorage.setItem('finanse.skin', window.SKIN); } catch (e) { /* zostaje do zamknięcia strony */ }
    return window.SKIN;
  };
})();
