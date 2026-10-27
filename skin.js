/* Skórka wyglądu – zapamiętana osobno na każdym urządzeniu (localStorage „finanse.skin”).
   Ładowana w <head> przed resztą strony, żeby nie mignął zły motyw. Domyślnie: klasyczny. */
(function () {
  var FONTS = {
    neon: 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap',
    sunset: 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,600;0,700;0,800;1,700;1,800;1,900&family=Yellowtail&display=swap',
    racer: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap'
  };
  var BAR = { classic: '#0d1420', neon: '#07070c', sunset: '#2a0e4a', racer: '#e9e4d9' };
  function apply(s) {
    if (!BAR[s]) s = 'classic';
    var d = document.documentElement;
    if (s === 'classic') d.removeAttribute('data-skin'); else d.setAttribute('data-skin', s);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[s]);
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', s === 'racer' ? 'light' : 'dark');   // Racer jest jasny
    if (FONTS[s] && !document.getElementById('skinFont-' + s)) {
      var l = document.createElement('link'); l.id = 'skinFont-' + s; l.rel = 'stylesheet'; l.href = FONTS[s];
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
