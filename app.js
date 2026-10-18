const CLIENT_VERSION = '12';
function startApp(initial) {
  'use strict';
  let D = initial;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zl = x => (x < 0 ? '−' : '') + Math.round(Math.abs(x || 0)).toLocaleString('pl-PL') + ' zł';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dni = n => n === 0 ? 'dziś' : n === 1 ? 'jutro' : 'za ' + n + ' dni';
  const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const zlc = x => (x < 0 ? '−' : '') + Math.abs(x || 0).toLocaleString('pl-PL', { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 }) + '\u00a0zł';
  const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const fmtDay = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS_GEN[m - 1]; };
  const fmtShort = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS_SHORT[m - 1]; };
  // „SPOŻYWCZE KOSMETYKI” → „Spożywcze kosmetyki”; krótkie skróty (OC/AC, TBS, NJU, E-ON) zostają.
  const pretty = s => String(s || '').split(' ').map((w, i) => /^[A-ZĄĆĘŁŃÓŚŹŻ]{4,}$/.test(w) ? (i ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase()) : w).join(' ');
  function labelFor(block, col) {
    const q = (D.quick || []).find(x => { const c = (D.categories || []).find(k => k.key === x.key); return c && c.block === block && c.col === col; });
    if (q) return q.label;
    const oc = (D.otherCols || []).find(o => o.block === block && o.col === col);
    if (oc) {
      const single = (D.categories || []).filter(c => c.blockId === oc.blockId && c.kind === 'expense').length === 1;
      return single ? block : block + ' – ' + pretty(col).toLowerCase();
    }
    return pretty(col);
  }
  const entryLabel = e => {
    if (e.label) return e.label;
    if (e.kind !== 'wpływ') return labelFor(...e.category.split(' / '));
    const f = (D.inflows || []).find(x => x.category === e.category);
    return f ? f.label : 'Wpływ';
  };
  // Kolory bloków (kolejność od dołu kolumny) – paleta sprawdzona walidatorem na ciemnym tle.
  const BLOCK_ORDER = ['mieszkanie', 'nieistotne', 'wazne', 'auto', 'tbs', 'kredyt', 'wakacje'];
  const BLOCK_COLOR = { mieszkanie: '#3987e5', nieistotne: '#d95926', wazne: '#199e70', auto: '#c98500', tbs: '#d55181', kredyt: '#008300', wakacje: '#9085e9', other: '#5b6779' };
  // kolory bloków: własne z Ustawień (zapisane w skrypcie, wspólne dla urządzeń) albo domyślne
  const colorOf = id => (D && D.prefs && D.prefs.colors && D.prefs.colors[id]) || BLOCK_COLOR[id] || '#5b6779';
  let VIEW = 'balance', ISO = null, CAT_SEL = 'year', TAB = 'teraz', VARIANT = 'A';
  const TABS = ['teraz', 'wydatki', 'plan', 'wpisy', 'urzadzenia'];
  let PREV_TAB = 'teraz';   // dokąd wraca „‹ Wróć” z ekranu Urządzenia
  const OPEN_CATS = new Set();
  try {
    VIEW = localStorage.getItem('finanse.view') === 'structure' ? 'structure' : 'balance';
    VARIANT = localStorage.getItem('finanse.variant') === 'B' ? 'B' : 'A';
    const tb = localStorage.getItem('finanse.tab'); if (TABS.indexOf(tb) >= 0) TAB = tb;
  } catch (e) { /* bez pamięci przeglądarki */ }
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bez pamięci przeglądarki */ } };
  let INSTALL = window.__installPrompt || null;   // zdarzenie „zainstaluj aplikację” z przeglądarki (Chrome, Brave, Edge)
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); INSTALL = e; const y = window.scrollY; render(); window.scrollTo(0, y); });
  window.addEventListener('appinstalled', () => { INSTALL = null; toast('Aplikacja zainstalowana. Otwieraj ją z ikony na ekranie.'); });
  let pairTimer = null;
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-install]') && INSTALL) {
      const ev = INSTALL; INSTALL = null;
      ev.prompt(); try { await ev.userChoice; } catch (err) { /* anulowano */ }
      const y = window.scrollY; render(); window.scrollTo(0, y);
      return;
    }
    const ack = e.target.closest('[data-dev-ack]');
    if (ack) {
      ack.disabled = true;
      try {
        const r = await call('confirmDevice', { id: ack.dataset.devAck });
        if (!r.ok) throw new Error(r.error);
        D.devices = r.devices; window.saveCache(D); rerender();
        toast('Potwierdzone. Ostrzeżenie zniknie na wszystkich urządzeniach.');
      } catch (err) { ack.disabled = false; toast('Nie udało się potwierdzić: ' + esc(err.message || err)); }
      return;
    }
    const rn = e.target.closest('[data-dev-rename]');
    if (rn) {
      const li = rn.closest('li.dev'), id = rn.dataset.devRename, d = D.devices.list.find(x => x.id === id);
      const nm = li.querySelector('.nm');
      nm.innerHTML = `<form class="dev-rename"><input maxlength="40" value="${esc(d.name)}" aria-label="Nowa nazwa urządzenia"><button type="submit" class="btn-sm">Zapisz</button><button type="button" class="edit" data-dev-cancel>Anuluj</button></form>`;
      const inp = nm.querySelector('input'); inp.focus(); inp.select();
      nm.querySelector('[data-dev-cancel]').addEventListener('click', () => { const y = window.scrollY; render(); window.scrollTo(0, y); });
      nm.querySelector('form').addEventListener('submit', async ev => {
        ev.preventDefault();
        const name = inp.value.trim(); if (!name) return;
        try {
          const r = await call('renameDevice', { id, name });
          if (!r.ok) throw new Error(r.error);
          D.devices = r.devices; window.saveCache(D); const y = window.scrollY; render(); window.scrollTo(0, y);
          toast('Zmieniono nazwę na „' + esc(name) + '”.');
        } catch (err) { toast('Nie udało się zmienić nazwy: ' + esc(err.message || err)); }
      });
      return;
    }
    const rm = e.target.closest('[data-dev-remove]');
    if (rm) {
      const id = rm.dataset.devRemove, d = (D.devices.list || []).find(x => x.id === id) || { name: 'urządzenie' };
      // potwierdzenie drugim dotknięciem; stan trzymany poza przyciskiem, bo odświeżenie w tle przerysowuje listę
      if (!(DEV_ARMED.id === id && DEV_ARMED.until > Date.now())) {
        DEV_ARMED.id = id; DEV_ARMED.until = Date.now() + 4000;
        document.querySelectorAll(`[data-dev-remove="${id}"]`).forEach(b => { b.dataset.armed = '1'; b.textContent = 'Na pewno?'; });
        setTimeout(() => { if (DEV_ARMED.id === id && DEV_ARMED.until <= Date.now()) { DEV_ARMED.id = null; const y = window.scrollY; render(); window.scrollTo(0, y); } }, 4100);
        return;
      }
      DEV_ARMED.id = null;
      rm.disabled = true;
      try {
        const r = await call('removeDevice', { id });
        if (!r.ok) throw new Error(r.error);
        if (r.self) { window.forgetDevice(); location.reload(); return; }
        D.devices = r.devices; window.saveCache(D); const y = window.scrollY; render(); window.scrollTo(0, y);
        toast('Usunięto „' + esc(d.name) + '”. To urządzenie straciło dostęp do arkusza.');
      } catch (err) { rm.disabled = false; toast('Nie udało się usunąć: ' + esc(err.message || err)); }
      return;
    }
    const pb = e.target.closest('[data-pair]');
    if (pb) {
      const box = document.getElementById('pairBox');
      pb.disabled = true;
      try {
        const r = await call('pairStart');
        if (!r || !r.ok) throw new Error(r && r.error || 'Nie udało się utworzyć kodu.');
        let left = r.seconds || 300;
        const paint = () => {
          box.innerHTML = left > 0
            ? `<div class="pair-code num" aria-label="Kod ${r.code.split('').join(' ')}">${r.code.slice(0, 3)} ${r.code.slice(3)}</div><p>Na nowym urządzeniu otwórz aplikację, wybierz „Kod z innego urządzenia” i wpisz ten kod. Ważny jeszcze <b class="num">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b>, działa raz.</p>`
            : '<p>Kod wygasł. Poproś o nowy, jeśli nadal chcesz połączyć urządzenie.</p>';
        };
        box.hidden = false; paint();
        clearInterval(pairTimer);
        pairTimer = setInterval(() => { left--; if (!document.getElementById('pairBox')) { clearInterval(pairTimer); return; } paint(); if (left <= 0) clearInterval(pairTimer); }, 1000);
      } catch (err) { box.hidden = false; box.innerHTML = `<p class="err">${esc(err.message || err)}</p>`; }
      finally { pb.disabled = false; }
      return;
    }
    const ub = e.target.closest('[data-unlink]');
    if (ub) {
      if (!ub.dataset.armed) { ub.dataset.armed = '1'; ub.textContent = 'Na pewno odłączyć?'; setTimeout(() => { if (ub.isConnected) { delete ub.dataset.armed; ub.textContent = 'Odłącz to urządzenie'; } }, 4000); return; }
      window.forgetDevice(); location.reload();
    }
  });

  /* ================= zakładki: Teraz / Wydatki / Plan / Wpisy ================= */
  function syncTabbar() {
    document.querySelectorAll('[data-tab]').forEach(b => { if (b.dataset.tab === TAB) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.body.classList.toggle('dev-alert', newDevices().length > 0);   // czerwona kropka na ikonie tarczy
  }
  function drawVisible() {
    if (TAB === 'wydatki') drawYear();
    if (TAB === 'plan') drawSavings();
  }
  function setTab(name, keepScroll) {
    if (TABS.indexOf(name) < 0) return;
    if (name === 'wpisy' && isWide()) name = 'teraz';
    if (name === 'urzadzenia' && TAB !== 'urzadzenia') PREV_TAB = TAB;
    if (name === 'urzadzenia' && TAB === 'urzadzenia') name = PREV_TAB;   // drugie dotknięcie ikony wraca
    TAB = name; store('finanse.tab', name === 'urzadzenia' ? PREV_TAB : name);
    document.querySelectorAll('[data-tabview]').forEach(v => { v.hidden = v.dataset.tabview !== name; });
    syncTabbar();
    if (!keepScroll) window.scrollTo(0, 0);
    drawVisible();
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab], [data-goto]');
    if (t) { setTab(t.dataset.tab || t.dataset.goto); return; }
    const v = e.target.closest('[data-variant]');
    if (v && v.dataset.variant !== VARIANT) { VARIANT = v.dataset.variant; store('finanse.variant', VARIANT); const y = window.scrollY; render(); window.scrollTo(0, y); }
  });
  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.dataset || !d.dataset.keep) return;
    if (d.open) OPEN_CATS.add(d.dataset.keep); else OPEN_CATS.delete(d.dataset.keep);
  }, true);
  const fmtN = x => (x < 0 ? '−' : '') + Math.round(Math.abs(x || 0)).toLocaleString('pl-PL');
  // przedział „39 004 – 40 486 zł”, a gdy warianty prawie równe – jedna kwota
  // Jedna kwota według wybranego wariantu dochodu (Plan → Dochód w prognozie). Przedział „a – b” zostaje w zlRange.
  const zlR = (a, b) => zl(VARIANT === 'B' ? b : a);
  const zlRange = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return hi - lo < 50 ? zl(a) : fmtN(lo) + '\u00a0– ' + fmtN(hi) + '\u00a0zł'; };
  const isWide = () => window.matchMedia && matchMedia('(min-width: 1200px)').matches;
  const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS_GEN[m - 1] + ' ' + y; };
  const STATE = {
    ok: { cls: 'good', label: 'w normie', ico: '✓', col: 'var(--good)' },
    warn: { cls: 'warning', label: 'blisko limitu', ico: '!', col: 'var(--warning)' },
    over: { cls: 'critical', label: 'ponad limit', ico: '✕', col: 'var(--critical)' }
  };
  /* ================= urządzenia ================= */
  const two = n => String(n).padStart(2, '0');
  function whenTxt(iso) {
    if (!iso) return '–';
    const d = new Date(iso), now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const hm = two(d.getHours()) + ':' + two(d.getMinutes());
    if (dd === day) return 'dziś ' + hm;
    if (day - dd === 864e5) return 'wczoraj ' + hm;
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + hm;
  }
  const DEV_ARMED = { id: null, until: 0 };
  const armedTxt = (id, txt) => DEV_ARMED.id === id && DEV_ARMED.until > Date.now() ? 'Na pewno?' : txt;
  function knownDevices() { try { return JSON.parse(localStorage.getItem('finanse.knownDevices') || '[]'); } catch (e) { return []; } }
  // niepotwierdzone urządzenie (połączone kluczem, a nie kodem z Twojego urządzenia) – pytamy „To Twoje?” na wszystkich urządzeniach
  function newDevices() {
    if (!D || !D.devices) return [];
    return D.devices.list.filter(d => d.active && !d.current && d.confirmed === false);
  }
  const DEV_ICON = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    pc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/></svg>'
  };
  const EVENT_TXT = {
    connect: e => `Połączono „${esc(e.name)}”: ${esc(e.info)}`,
    confirm: e => `Potwierdzono „${esc(e.name)}” jako Twoje`,
    remove: e => `Usunięto „${esc(e.name)}” ${esc(e.info)}`,
    rename: e => `Nowa nazwa „${esc(e.name)}” (${esc(e.info)})`,
    blocked: e => `Zablokowano „${esc(e.name)}”: ${esc(e.info)}`,
    pair_fail: e => `Błędne kody parowania: ${esc(e.info)}`,
    key_new: () => 'Utworzono nowy klucz główny'
  };
  function devicesPanel() {
    const DV = D.devices;
    const head = `<div class="panel-head"><div><h2 id="h-dev">Urządzenia</h2>
      <p class="desc">${DV ? 'Te urządzenia mają dostęp do Twojego arkusza. Jeśli widzisz obce, usuń je, a dla pewności utwórz nowy klucz w Apps Script.' : 'Żeby zobaczyć listę urządzeń, wklej w Apps Script nowy Code.gs (wersja 11).'}</p></div>
      <button type="button" class="btn-sm" data-pair>+ Połącz nowe</button></div>
      <div class="pair-box" id="pairBox" hidden></div>`;
    const install = INSTALL ? '<div class="dev-acts"><button type="button" class="btn-sm" data-install>Zainstaluj aplikację na tym urządzeniu</button></div>' : '';
    if (!DV) return `<section class="panel device" aria-labelledby="h-dev">${head}${install}<div class="dev-acts"><button type="button" class="btn-sm warn-sm" data-unlink>Odłącz to urządzenie</button></div></section>`;
    const active = DV.list.filter(d => d.active).sort((a, b) => (b.current - a.current) || String(b.seen).localeCompare(String(a.seen)));
    const removed = DV.list.filter(d => !d.active);
    const row = d => `<li class="dev${d.current ? ' me' : ''}${!d.current && d.confirmed === false ? ' fresh' : ''}" data-dev="${esc(d.id)}">
      <span class="dev-ico">${/Android|iOS|iPad|Telefon|Tablet/i.test(d.desc + ' ' + d.name) ? DEV_ICON.phone : DEV_ICON.pc}</span>
      <div class="dev-body"><div class="nm"><span class="dev-name">${esc(d.name)}</span>${d.current ? '<span class="badge">to urządzenie</span>' : ''}</div>
        ${d.desc ? `<div class="sub">${esc(d.desc)}</div>` : ''}
        <div class="sub">połączone ${whenTxt(d.created)}${d.method === 'kod' ? ' kodem' : d.method === 'klucz' ? ' kluczem' : ''}, ostatnio ${d.current ? 'teraz' : whenTxt(d.seen)}</div>
        ${!d.current && d.confirmed === false ? '<div class="sub warn-line">Niepotwierdzone. Jeśli to nie Twoje urządzenie, usuń je.</div>' : ''}
        <div class="acts">${!d.current && d.confirmed === false ? `<button type="button" class="edit" data-dev-ack="${esc(d.id)}">To moje</button>` : ''}<button type="button" class="edit" data-dev-rename="${esc(d.id)}">Zmień nazwę</button><button type="button" class="edit warn-txt" data-dev-remove="${esc(d.id)}">${armedTxt(d.id, d.current ? 'Odłącz to urządzenie' : 'Usuń')}</button></div>
      </div></li>`;
    const hist = DV.events.length || removed.length ? `<details class="paid-more" data-keep="devhist"${OPEN_CATS.has('devhist') ? ' open' : ''}><summary><span>Historia <small>${DV.events.length}</small></span><span class="chev" aria-hidden="true">▶</span></summary>
      <ul class="dev-events">${DV.events.map(e => `<li class="ev-${esc(e.type)}"><span class="t">${whenTxt(e.t)}</span><span>${(EVENT_TXT[e.type] || (x => esc(x.info)))(e)}</span></li>`).join('')}</ul></details>` : '';
    return `<section class="panel device" aria-labelledby="h-dev">${head}<ul class="dev-list">${active.map(row).join('')}</ul>${install}${hist}</section>`;
  }

  function rerender() { const y = window.scrollY; render(); renderRecent(); window.scrollTo(0, y); }

  /* ================= wpisy: kolejka (zapis bez internetu), wyszukiwanie, edycja ================= */
  const OUTBOX = 'finanse.outbox';
  const readOutbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch (e) { return []; } };
  const writeOutbox = list => { try { localStorage.setItem(OUTBOX, JSON.stringify(list)); } catch (e) { /* bez pamięci */ } };
  const newCid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);
  // wpisy z kolejki pokazujemy na górze listy jako „czeka na wysłanie”
  function allEntries() {
    const pend = readOutbox().map(it => ({ id: 'q:' + it.cid, pending: true, error: it.error || '', date: it.payload.date, kind: it.payload.kind === 'income' ? 'wpływ' : 'wydatek',
      label: it.label, amount: it.payload.amount, desc: it.payload.desc || '', unpaid: !!it.payload.unpaid }));
    return pend.reverse().concat(D.entries || []);
  }
  function logList(list) {
    return `<ul class="log">${list.map(e => `<li class="${e.undone ? 'undone' : ''}${e.pending ? ' pending' : ''}${e.error ? ' failed' : ''}">
        <button type="button" class="log-row" data-entry="${esc(e.id)}" aria-label="Szczegóły wpisu: ${esc(entryLabel(e))}, ${zlc(e.amount)}">
        <span class="d">${fmtShort(e.date)}</span>
        <span class="c"><b>${esc(entryLabel(e))}</b>${e.desc ? `<small>${esc(e.desc)}</small>` : ''}${e.unpaid ? '<small class="tag">niezapłacone</small>' : ''}${e.error ? `<small class="tag err">nie zapisano: ${esc(e.error)}</small>` : e.pending ? '<small class="tag wait">czeka na wysłanie</small>' : ''}${e.edited ? '<small class="tag muted-tag">zmieniony</small>' : e.undone ? '<small class="tag muted-tag">cofnięty</small>' : ''}</span>
        <span class="a num">${e.kind === 'wpływ' ? '+' : ''}${zlc(e.amount)}</span>
        <span class="chev" aria-hidden="true">›</span></button>
      </li>`).join('')}</ul>`;
  }
  let SEARCH = '';
  function searchResults(list) {
    const words = SEARCH.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = !words.length ? list.slice(0, 60) : list.filter(e => {
      const hay = (e.date + ' ' + fmtShort(e.date) + ' ' + entryLabel(e) + ' ' + (e.desc || '') + ' ' + zlc(e.amount) + ' ' + String(e.amount).replace('.', ',')).toLowerCase();
      return words.every(w => hay.indexOf(w) >= 0);
    });
    const shown = hit.slice(0, 200);
    let head = '';
    if (words.length) {
      const live = hit.filter(e => !e.undone);
      const out = live.filter(e => e.kind !== 'wpływ').reduce((a, e) => a + e.amount, 0), inc = live.filter(e => e.kind === 'wpływ').reduce((a, e) => a + e.amount, 0);
      head = `<p class="search-sum">${hit.length ? `Znaleziono ${hit.length} ${hit.length === 1 ? 'wpis' : hit.length < 5 ? 'wpisy' : 'wpisów'}${out ? `, wydatki razem <b class="num">${zlc(Math.round(out * 100) / 100)}</b>` : ''}${inc ? `, wpływy <b class="num">${zlc(Math.round(inc * 100) / 100)}</b>` : ''}.` : 'Nic nie znaleziono.'}${hit.length > shown.length ? ' Pokazuję pierwsze 200.' : ''}</p>`;
    } else if (list.length > shown.length) head = `<p class="search-sum">Ostatnie ${shown.length} z ${list.length}. Wpisz szukaną frazę, żeby przeszukać wszystkie.</p>`;
    return head + (shown.length ? logList(shown) : '');
  }
  document.addEventListener('input', e => {
    if (!e.target.matches || !e.target.matches('[data-search]')) return;
    SEARCH = e.target.value;
    document.querySelectorAll('[data-search-out]').forEach(o => { o.innerHTML = searchResults(allEntries()); });
    document.querySelectorAll('[data-search]').forEach(i => { if (i !== e.target) i.value = SEARCH; });
  });

  let flushing = false, retryTimer = null;
  async function flushOutbox() {
    if (flushing || navigator.onLine === false) return;
    let list = readOutbox().filter(x => !x.error);
    if (!list.length) return;
    flushing = true; document.body.classList.add('syncing');
    let model = null; const sent = [];
    try {
      for (const it of list) {
        let r;
        try { r = await call('addEntry', it.payload); } catch (err) { break; }   // brak sieci albo dostępu – spróbujemy później
        const now = readOutbox();
        if (r && r.ok) { writeOutbox(now.filter(x => x.cid !== it.cid)); model = r.model; sent.push({ it, e: r.entry }); }
        else { const x = now.find(y => y.cid === it.cid); if (x) { x.error = (r && r.error) || 'Nie udało się zapisać.'; writeOutbox(now); } toast(`Nie zapisano ${zlc(it.payload.amount)}: ${esc(it.label)}. ${esc((r && r.error) || '')}`); }
      }
    } finally { flushing = false; document.body.classList.remove('syncing'); }
    if (model) applyModel(model); else rerender();
    if (sent.length === 1) {
      const { it, e } = sent[0];
      if (it.payment) {
        const nx = (D.payments || []).find(x => x.name === it.payment);
        toast(`Zapłacone ${zlc(e.amount)}: ${esc(it.payment)}${e.month ? ' (' + e.month.toLowerCase() + ')' : ''}${e.creditUsed ? `<small>z nadpłaty ${zlc(e.creditUsed)}</small>` : ''}${nx ? `<small>Następny termin: ${fmtDay(nx.dueDate)}</small>` : ''}`, e.id);
      } else if (it.payload.kind === 'expense' && e.date) {
        const [ky, km] = e.date.split('-').map(Number), [bid, ck] = it.payload.key.split('::');
        const l = ky === D.year && km - 1 === D.currentMonth ? D.limits.find(x => x.blockId === bid && (!x.cols || x.cols.indexOf(ck) >= 0)) : null;
        if (l) toast(`Zapisane w arkuszu.<small>Limit ${esc(l.name)}: ${zl(l.value)} z ${zl(l.limit)}${l.status === 'over' ? ', przekroczony' : l.status === 'warn' ? ', blisko' : ''}</small>`, e.id);
      }
    }
    scheduleRetry();
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (readOutbox().some(x => !x.error)) retryTimer = setTimeout(flushOutbox, 60000);
  }
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushOutbox(); });


  /* ================= ustawienia: przypomnienia ================= */
  function remindersPanel() {
    const R = (D.prefs && D.prefs.reminders) || null;
    if (!R) return `<section class="panel" aria-labelledby="h-rem"><h2 id="h-rem">Przypomnienia o płatnościach</h2><p class="desc">Wklej w Apps Script nowy Code.gs (wersja 12), żeby włączyć przypomnienia.</p></section>`;
    const opt = (vals, cur, fmt) => vals.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    const status = R.error ? `<p class="rem-err">${esc(R.error)}</p>`
      : R.enabled ? `<p class="desc">${R.lastSync ? `W kalendarzu „${esc(R.calendar)}” jest ${R.count} ${R.count === 1 ? 'termin' : R.count > 1 && R.count < 5 ? 'terminy' : 'terminów'}. Zaktualizowano ${whenTxt(R.lastSync)}; potem co godzinę.` : 'Włączone. Pierwsze terminy pojawią się w kalendarzu w ciągu godziny.'}</p>`
      : '';
    return `<section class="panel reminders" aria-labelledby="h-rem"><div class="panel-head"><div><h2 id="h-rem">Przypomnienia o płatnościach</h2>
      <p class="desc">Terminy płatności i opłat rocznych trafiają do osobnego kalendarza Google. Powiadomienia na telefon wysyła aplikacja Kalendarz Google.</p></div>
      <button type="button" class="btn-sm${R.enabled ? '' : ' primary-sm'}" data-rem-toggle>${R.enabled ? 'Wyłącz' : 'Włącz'}</button></div>
      ${status}
      ${R.enabled ? `<div class="rem-opts">
        <label class="field"><span>Przypomnij wcześniej</span><select id="remDays">${opt([0, 1, 2, 3, 5, 7], R.days, v => v === 0 ? 'tylko w dniu terminu' : v === 1 ? '1 dzień przed' : v + ' dni przed')}</select></label>
        <label class="field"><span>O godzinie</span><select id="remHour">${opt([7, 8, 9, 10, 12, 16, 18, 20], R.hour, v => v + ':00')}</select></label>
      </div>
      <p class="hint-avg">W aplikacji Kalendarz Google na telefonie sprawdź, czy kalendarz „${esc(R.calendar)}” jest widoczny i ma włączone powiadomienia.</p>` : ''}
    </section>`;
  }
  async function saveRem(patch) {
    const R = Object.assign({}, D.prefs.reminders, patch);
    try {
      const r = await call('saveReminders', { enabled: R.enabled, days: R.days, hour: R.hour });
      if (!r.ok) throw new Error(r.error);
      applyModel(r.model);
      const now = D.prefs.reminders;
      toast(now.error ? 'Przypomnienia wymagają jeszcze zgody w Apps Script.' : now.enabled ? 'Przypomnienia włączone.' : 'Przypomnienia wyłączone. Wydarzenia usunięte z kalendarza.');
    } catch (err) { toast('Nie udało się zapisać: ' + esc(err.message || err)); }
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-rem-toggle]'); if (b) { b.disabled = true; saveRem({ enabled: !D.prefs.reminders.enabled }); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'remDays') saveRem({ days: +e.target.value });
    if (e.target.id === 'remHour') saveRem({ hour: +e.target.value });
  });

  /* ================= ustawienia: kolory kategorii ================= */
  let COLOR_DRAFT = null;   // zmiany przed zapisem
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function colorDistance(a, b) {   // przybliżona różnica barw (ważony RGB) – poniżej ok. 60 kolory łatwo pomylić
    const [r1, g1, b1] = hexRgb(a), [r2, g2, b2] = hexRgb(b), rm = (r1 + r2) / 2;
    return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2) / 3;
  }
  function colorsPanel() {
    const ids = BLOCK_ORDER.filter(id => D.blocks.some(b => b.id === id));
    const col = id => (COLOR_DRAFT && COLOR_DRAFT[id]) || colorOf(id);
    const pairs = [];
    ids.forEach((a, i) => ids.slice(i + 1).forEach(b => { if (colorDistance(col(a), col(b)) < 60) pairs.push([a, b]); }));
    const nameOf = id => D.blocks.find(b => b.id === id).name;
    const custom = D.prefs && D.prefs.colors && Object.keys(D.prefs.colors).length;
    return `<section class="panel colors" aria-labelledby="h-col"><h2 id="h-col">Kolory kategorii</h2>
      <p class="desc">Kolory na wykresach i listach, takie same na wszystkich urządzeniach. Dotknij koloru, żeby go zmienić.</p>
      <div class="col-prev" aria-hidden="true">${ids.map(id => `<span style="background:${col(id)}"></span>`).join('')}</div>
      <ul class="col-list">${ids.map(id => `<li><label><input type="color" value="${col(id)}" data-color="${id}" aria-label="Kolor: ${esc(nameOf(id))}"><span>${esc(nameOf(id))}</span></label>
        ${col(id) !== BLOCK_COLOR[id] ? `<button type="button" class="edit" data-color-reset="${id}">domyślny</button>` : ''}</li>`).join('')}</ul>
      ${pairs.length ? `<p class="rem-err">Podobne kolory: ${pairs.map(p => esc(nameOf(p[0])) + ' i ' + esc(nameOf(p[1]))).join('; ')}. Na wykresie trudno będzie je odróżnić.</p>` : ''}
      <div class="dev-acts">${COLOR_DRAFT ? '<button type="button" class="btn-sm primary-sm" data-color-save>Zapisz kolory</button><button type="button" class="btn-sm" data-color-cancel>Anuluj</button>' : ''}
        ${custom && !COLOR_DRAFT ? '<button type="button" class="btn-sm" data-color-default>Przywróć domyślne</button>' : ''}</div>
    </section>`;
  }
  // podczas wybierania (input) zmieniamy tylko podgląd, żeby nie zamknąć okna wyboru koloru; po wyborze (change) odświeżamy panel
  const colorIds = () => BLOCK_ORDER.filter(id => D.blocks.some(b => b.id === id));
  document.addEventListener('input', e => {
    const id = e.target.dataset && e.target.dataset.color;
    if (!id) return;
    COLOR_DRAFT = Object.assign({}, COLOR_DRAFT || {}, { [id]: e.target.value });
    const spans = document.querySelectorAll('.col-prev span'), ids = colorIds();
    spans.forEach((sp, i) => { sp.style.background = (COLOR_DRAFT[ids[i]]) || colorOf(ids[i]); });
  });
  document.addEventListener('change', e => {
    if (!(e.target.dataset && e.target.dataset.color)) return;
    const box = document.querySelector('.colors');
    if (box) { const tmp = document.createElement('div'); tmp.innerHTML = colorsPanel(); box.replaceWith(tmp.firstElementChild); }
  });
  document.addEventListener('click', async e => {
    const rs = e.target.closest('[data-color-reset]');
    if (rs) { COLOR_DRAFT = Object.assign({}, COLOR_DRAFT || {}, { [rs.dataset.colorReset]: BLOCK_COLOR[rs.dataset.colorReset] }); rerender(); return; }
    if (e.target.closest('[data-color-cancel]')) { COLOR_DRAFT = null; rerender(); return; }
    const sv = e.target.closest('[data-color-save]'), df = e.target.closest('[data-color-default]');
    if (!sv && !df) return;
    const colors = df ? {} : Object.assign({}, (D.prefs && D.prefs.colors) || {}, COLOR_DRAFT);
    Object.keys(colors).forEach(k => { if (colors[k] === BLOCK_COLOR[k]) delete colors[k]; });
    try {
      const r = await call('saveColors', { colors });
      if (!r.ok) throw new Error(r.error);
      COLOR_DRAFT = null; animated = true; applyModel(r.model);
      toast(df ? 'Przywrócono domyślne kolory.' : 'Kolory zapisane na wszystkich urządzeniach.');
    } catch (err) { toast('Nie udało się zapisać kolorów: ' + esc(err.message || err)); }
  });

  function render() {
  const cur = D.current;
  const t = D.today;
  const wide = isWide();
  const V = { teraz: '', wydatki: '', plan: '', wpisy: '', urzadzenia: '' };
  const fcCur = (D.forecast || []).find(f => f.isCurrent);

  /* ================= pasek aplikacji (poza #app, aktualizowany przy każdym render) ================= */
  document.getElementById('abSub').textContent = `stan na ${t.d} ${MONTHS_GEN[t.m]}`;
  const sheetA = document.getElementById('abSheet');
  if (D.sheetUrl) { sheetA.href = D.sheetUrl; sheetA.hidden = false; } else sheetA.hidden = true;
  if (wide && TAB === 'wpisy') TAB = 'teraz';
  syncTabbar();

  /* ================= TERAZ: miesiąc ================= */
  if (cur) {
    const income = VARIANT === 'B' && fcCur ? fcCur.incomeB : cur.expectedIncome;
    const spent = cur.expenses, expected = Math.max(cur.expectedExpenses, spent);
    const rest = expected - spent, left = income - expected;
    const waiting = income > cur.income + 1;
    const daysIn = new Date(D.year, t.m + 1, 0).getDate(), daysLeft = daysIn - t.d;
    const scale = Math.max(income, expected, 1);
    const seg = (v, cls, label) => v > 0 ? `<span class="${cls}" style="flex-basis:${(v / scale * 100).toFixed(2)}%" title="${label}: ${zl(v)}"></span>` : '';
    V.teraz += `<section class="month" aria-labelledby="h-month">
      <div class="m-head"><h1 id="h-month">${esc(cur.name)}</h1><span>${daysLeft === 0 ? 'ostatni dzień miesiąca' : daysLeft === 1 ? 'został 1 dzień' : `zostało ${daysLeft} dni`}</span></div>
      <p class="m-label">${left >= 0 ? (waiting ? 'Po wypłacie zostanie około' : 'Na koniec miesiąca zostanie około') : 'Na koniec miesiąca zabraknie około'}</p>
      <p class="m-big num${left < 0 ? ' neg' : ''}">${zl(Math.abs(left))}</p>
      <div class="meter" role="img" aria-label="Wydane ${zl(spent)}, jeszcze wydasz około ${zl(rest)}, ${left >= 0 ? 'zostanie ' + zl(left) : 'brakuje ' + zl(-left)} z dochodu ${zl(income)}">
        ${seg(spent, 'sp', 'Wydane')}${seg(rest, 'rs', 'Jeszcze wydasz (typowo)')}${seg(left, 'lf', 'Zostanie')}
      </div>
      <div class="m-stats">
        <div><span><i class="k sp"></i>Wydane</span><b class="num">${zl(spent)}</b></div>
        <div><span><i class="k rs"></i>Jeszcze wydasz</span><b class="num">${zl(rest)}</b></div>
        <div><span><i class="k in"></i>Dochód</span><b class="num">${zl(income)}</b></div>
      </div>
    </section>`;
  } else {
    V.teraz += `<section class="month"><div class="m-head"><h1>Rok ${D.year}</h1></div><p class="m-label">Zostało w ${D.year}</p><p class="m-big num">${zl(D.ytd.left)}</p></section>`;
  }

  /* ================= TERAZ: alerty (tylko to, czego nie ma niżej na tym ekranie) ================= */
  const alerts = [];
  D.deadlines.filter(d => d.alert).forEach(d => alerts.push({
    s: d.daysLeft <= 14 ? 'over' : 'warn',
    t: `<b>${esc(d.name)}</b> ${dni(d.daysLeft)} (${fmtDate(d.date)}). Przygotuj około <span class="num">${zl(d.amount)}</span>.`
  }));
  if (D.unpaid.length) alerts.push({ s: 'warn', t: `<b>Do zapłaty</b>: ${D.unpaid.map(u => esc(u.block) + ', ' + esc(labelFor(u.block, u.col)) + (u.amount ? ' <span class="num">' + zl(u.amount) + '</span>' : '')).join('; ')}.` });
  D.missing.forEach(x => alerts.push({ s: 'warn', t: `<b>Do uzupełnienia w arkuszu</b>: ${esc(x.block)}, ${esc(x.col)} (${x.month.toLowerCase()}), „${esc(x.text)}”.` }));
  D.warnings.forEach(w => alerts.push({ s: 'warn', t: esc(w) }));
  newDevices().forEach(d => alerts.push({ s: 'over', t: `<b>Nowe urządzenie: ${esc(d.name)}</b>${d.desc ? ` (${esc(d.desc)})` : ''}, połączone ${whenTxt(d.created)}. To Twoje? <span class="alert-acts"><button type="button" class="edit" data-dev-ack="${esc(d.id)}">Tak, moje</button><button type="button" class="edit warn-txt" data-dev-remove="${esc(d.id)}">Usuń je</button></span>` }));
  if (alerts.length) {
    V.teraz += `<ul class="alerts" aria-label="Alerty">${alerts.map(a => `<li><span class="ico ${STATE[a.s].cls}" aria-label="${STATE[a.s].label}">${STATE[a.s].ico}</span><div>${a.t}</div></li>`).join('')}</ul>`;
  }

  /* ================= TERAZ: płatności ================= */
  const PAY_TXT = { overdue: 'po terminie', urgent: 'pilne', soon: 'wkrótce', ok: 'zaplanowane', paid: 'zapłacone' };
  const payRow = p => {
    const when = p.daysLeft < 0 ? `<b>po terminie ${-p.daysLeft} ${p.daysLeft === -1 ? 'dzień' : 'dni'}</b> (${fmtDay(p.dueDate)})`
      : `do ${fmtDay(p.dueDate)}, <b>${dni(p.daysLeft)}</b>`;
    const inv = p.invoiceDate ? (p.waiting ? `faktura ${fmtDay(p.invoiceDate)}` : `faktura z ${fmtDay(p.invoiceDate)}`) : '';
    const sub = p.state === 'paid' && p.paid ? `✓ ${p.paid.month.toLowerCase()} zapłacony${p.paid.amount ? ', ' + zlc(p.paid.amount) : ' z nadpłaty'}${inv ? `; następna ${inv}` : ''}`
      : (inv ? inv + ', ' : '') + `za ${p.periodMonth.toLowerCase()}${p.periodYear !== D.year ? ' ' + p.periodYear : ''}${p.every > 1 ? ', co ' + p.every + ' mies.' : ''}`;
    const credit = p.credit > 0 ? `<div class="sub">nadpłata ${zlc(p.credit)}</div>` : '';
    const amount = p.toPay !== null ? zlc(p.toPay) : '';
    return `<li class="pay st-${p.state}"><span class="stripe" aria-hidden="true"></span>
      <div><div class="nm">${esc(p.name)} <span class="sr">(${PAY_TXT[p.state]})</span></div><div class="when">${when}</div>${p.state === 'paid'
        ? `<div class="sub">${sub}</div>${credit}<div class="acts"><button type="button" class="pay-btn ghost" data-pay="${p.row}">Zapłać z góry</button><button type="button" class="edit" data-pay-edit="${p.row}">Edytuj</button></div></div>
      <div class="act"><span class="amt">${amount}</span></div></li>`
        : `<div class="sub">${sub}<button type="button" class="edit" data-pay-edit="${p.row}">Edytuj</button></div>${credit}</div>
      <div class="act"><span class="amt">${amount}</span><button type="button" class="pay-btn" data-pay="${p.row}">Zapłać</button></div></li>`}`;
  };
  const pays = D.payments || [], due = pays.filter(p => p.state !== 'paid'), paid = pays.filter(p => p.state === 'paid');
  const dueSum = due.reduce((s, p) => s + (p.toPay || 0), 0);
  let payH = `<section class="panel" aria-labelledby="h-pay"><div class="panel-head"><div><h2 id="h-pay">Do zapłaty</h2>
    <p class="desc">${due.length ? `${due.length} ${due.length === 1 ? 'płatność' : due.length < 5 ? 'płatności' : 'płatności'}, razem około <b class="num">${zlc(Math.round(dueSum))}</b>. Na czerwono 5 dni przed terminem.` : pays.length ? 'Wszystko zapłacone w tym okresie.' : 'Dodaj czynsz, abonamenty i rachunki z terminem zapłaty.'}</p></div>
    <button type="button" class="btn-sm" data-pay-new>+ Dodaj</button></div>`;
  if (due.length) payH += `<ul class="pay-list">${due.map(payRow).join('')}</ul>`;
  if (paid.length) payH += `<details class="paid-more" data-keep="paid"${OPEN_CATS.has('paid') ? ' open' : ''}><summary><span>Zapłacone w tym okresie <small>${paid.length}</small></span><span class="chev" aria-hidden="true">▶</span></summary><ul class="pay-list">${paid.map(payRow).join('')}</ul></details>`;
  payH += `</section>`;

  /* ================= TERAZ: limity ================= */
  const lastIdx = Math.min(D.currentMonth, 11);
  let limH = `<section class="panel" aria-labelledby="h-lim"><div class="panel-head"><div><h2 id="h-lim">Limity${cur ? ' w tym miesiącu' : ''}</h2>
    <p class="desc">Słupki pod spodem to kolejne miesiące roku.</p></div><button type="button" class="btn-sm" data-limit-new>+ Dodaj</button></div>`;
  if (!D.limits.length) limH += `<p class="desc">Nie ma aktywnych limitów. Dodaj pierwszy przyciskiem obok.</p>`;
  D.limits.forEach(l => {
    const st = STATE[l.status];
    const v = l.value || 0;
    const scale = Math.max(l.limit, v) * 1.08;
    const months = l.series.slice(0, lastIdx + 1);
    const mmax = Math.max(l.limit, ...months);
    const note = l.status === 'over' ? `o ${zl(v - l.limit)} za dużo` : l.status === 'warn' ? `zostało ${zl(l.limit - v)}` : `zostało ${zl(l.limit - v)}`;
    limH += `<div class="limit st-${l.status}">
      <div class="row"><span class="name">${esc(l.name)}</span><span class="amt num"><b>${zl(v)}</b> z ${zl(l.limit)}</span></div>
      <span class="state"><i style="background:${st.col}"></i>${st.label}, ${note}<button type="button" class="edit" data-limit-edit="${l.row}">Edytuj</button></span>
      <div class="track"><span data-w="${Math.min(100, v / scale * 100)}" style="background:${st.col}"></span><u style="left:${l.limit / scale * 100}%"></u></div>
      <div class="months">${months.map((x, i) => {
        const c = x > l.limit ? 'over' : x >= l.limit * D.warnPct / 100 ? 'warn' : '';
        return `<span class="${c}${i === D.currentMonth ? ' now' : ''}" style="height:${Math.max(10, x / mmax * 100)}%" title="${D.monthNames[i]}: ${zl(x)}"></span>`;
      }).join('')}</div>
      <div class="foot"><span>średnio ${zl(l.avg)} miesięcznie</span><span>ponad limit ${l.overCount} z ${l.monthsCount} mies.</span></div>
    </div>`;
  });
  (D.limitDefs || []).filter(l => !l.active).forEach(l => {
    limH += `<div class="limit off"><div class="row"><span class="name">${esc(l.name)}</span><span class="amt num">${zl(l.limit)}</span></div>
      <span class="state"><i style="background:var(--muted)"></i>wyłączony<button type="button" class="edit" data-limit-edit="${l.row}">Edytuj</button></span></div>`;
  });
  limH += `</section>`;
  V.teraz += `<div class="cols">${payH}${limH}</div>`;

  /* ================= wpisy: lista (zakładka Wpisy, panel boczny, skrót na ekranie Teraz) ================= */
  const entries = allEntries();

  const emptyLog = `<p class="empty-log">Nie ma jeszcze wpisów. Dodaj pierwszy przyciskiem „Dodaj”. Kwoty wpisane ręcznie w arkuszu tutaj się nie pojawiają.</p>`;
  const lastBought = entries.filter(e => !e.undone).reduce((m, e) => (e.date > m ? e.date : m), '');
  const logPanel = (n, extra) => `<section class="panel log-panel" aria-labelledby="h-log${extra || ''}"><h2 id="h-log${extra || ''}">Wpisy</h2>
    <p class="desc">${lastBought ? `Ostatni zakup w dzienniku jest z <b>${fmtDay(lastBought)}</b>. ` : ''}Dotknij wpisu, żeby go zmienić albo usunąć.</p>
    ${entries.length ? `<div class="search"><input type="search" class="search-in" data-search placeholder="Szukaj: opis, kategoria, kwota, data" value="${esc(SEARCH)}" aria-label="Szukaj wpisów"></div><div class="search-out" data-search-out>${searchResults(entries)}</div>` : emptyLog}</section>`;
  if (wide) document.getElementById('side').innerHTML = logPanel(40, 's');
  else {
    document.getElementById('side').innerHTML = '';
    if (entries.length) V.teraz += `<section class="panel recent-panel" aria-labelledby="h-rec"><div class="panel-head"><div><h2 id="h-rec">Ostatnie wpisy</h2>
      ${lastBought ? `<p class="desc">Ostatni zakup w dzienniku jest z <b>${fmtDay(lastBought)}</b>.</p>` : ''}</div><button type="button" class="btn-sm" data-goto="wpisy">Wszystkie</button></div>${logList(entries.slice(0, 3))}</section>`;
    V.wpisy = logPanel(40);
  }

  /* ================= WYDATKI: wykres roku ================= */
  const taxLegend = (D.yearMonths || []).some(x => x.crossA || x.crossB) ? '<span><i class="sw" style="background:var(--warning);width:3px"></i>drugi próg podatkowy</span>' : '';
  const blocksPresent = BLOCK_ORDER.filter(id => D.blocks.some(b => b.id === id));
  V.wydatki += `<section class="panel hero" aria-labelledby="h-year">
    <div class="panel-head"><div><h2 id="h-year">Dochód i wydatki w ${D.year}</h2>
    <p class="desc">${VIEW === 'structure' ? (ISO ? 'Tylko: ' + esc(D.blocks.find(b => b.id === ISO).name) + '. Dotknij nazwy w legendzie, żeby wrócić albo wybrać inny blok.' : 'Wydatki złożone z bloków, linia to dochód. Dotknij bloku w legendzie, żeby zobaczyć tylko jego.') : 'Pole między liniami to pieniądze, które zostają w danym miesiącu. Dotknij miesiąca, żeby zobaczyć, na co poszły pieniądze.'}</p></div>
    <div class="seg-sm" role="group" aria-label="Widok wykresu"><button type="button" data-view="balance" aria-pressed="${VIEW === 'balance'}">Bilans</button><button type="button" data-view="structure" aria-pressed="${VIEW === 'structure'}">Struktura</button></div></div>
    <div class="chart" id="yearChart"><div class="tip" id="tip" role="status"></div></div>
    <div class="legend">${VIEW === 'structure'
      ? blocksPresent.map(id => `<button type="button" data-iso="${id}" aria-pressed="${ISO === id}" class="${ISO && ISO !== id ? 'dim' : ''}"><i class="sw" style="background:${colorOf(id)}"></i>${esc(D.blocks.find(b => b.id === id).name)}</button>`).join('') +
        (ISO ? `<button type="button" data-iso="">Pokaż wszystkie</button>` : `<span><i class="sw line" style="background:var(--text)"></i>dochód</span><span><i class="sw" style="background:var(--muted);opacity:.45"></i>jaśniej = prognoza</span>`) + taxLegend
      : `<span><i class="sw line" style="background:var(--income)"></i>dochód</span>
      <span><i class="sw line" style="background:var(--expense)"></i>wydatki</span>
      <span><i class="sw" style="background:var(--left);opacity:.6"></i>zostaje</span>
      <span><i class="sw" style="background:var(--deficit);opacity:.6"></i>brakuje</span>
      <span><i class="dash"></i>prognoza (pasmo: ostrożnie i z premiami)</span>` + taxLegend}
    </div>
    <div class="figures">
      <div><span class="k">Zostało od stycznia</span><span class="v num">${zl(D.ytd.left)}</span><span class="s">${Math.round(D.ytd.rate * 100)}% dochodu z ${D.ytd.months} pełnych miesięcy</span></div>
      <div><span class="k">Wydane od stycznia</span><span class="v num">${zl(D.ytd.expenses)}</span><span class="s">w ${D.ytd.months} pełnych miesiącach</span></div>
      <div><span class="k">Średnio miesięcznie</span><span class="v num">${zl(D.ytd.months ? D.ytd.expenses / D.ytd.months : 0)}</span><span class="s">wydatków, dochód średnio ${zl(D.ytd.months ? D.ytd.income / D.ytd.months : 0)}</span></div>
    </div>
  </section>`;
  V.wydatki += `<section class="panel" aria-labelledby="h-cat"><h2 id="h-cat">Na co idą pieniądze</h2>
    <p class="desc">Dotknij kategorii, żeby zobaczyć szczegóły.</p>
    <div class="tabs-wrap"><button type="button" class="tabs-arrow l" id="catPrev" aria-label="Przewiń w lewo (nowsze miesiące)" data-off><span aria-hidden="true">‹</span></button><div class="tabs" id="catTabs" role="group" aria-label="Okres"></div><button type="button" class="tabs-arrow r" id="catNext" aria-label="Przewiń w prawo (starsze miesiące)" data-off><span aria-hidden="true">›</span></button></div><div id="catList"></div></section>`;

  /* ================= PLAN: wariant dochodu + podsumowanie ================= */
  const saveMonthly = D.deadlines.filter(d => d.daysLeft >= 0 && d.daysLeft <= 366).reduce((s, d) => s + d.monthly, 0);
  const nextDl = D.deadlines.find(d => d.daysLeft >= 0);
  V.plan += `<section class="panel variant" aria-labelledby="h-var"><div class="panel-head"><div><h2 id="h-var">Dochód w prognozie</h2>
    <p class="desc">${VARIANT === 'B' ? `Średnia z premiami: ${zl(D.tax.netB)} netto przed drugim progiem.` : `Pensja podstawowa: ${zl(D.tax.netA)} netto (${zl(D.tax.grossA)} brutto) przed drugim progiem.`} Wszystkie kwoty w Planie liczą się według tego wyboru.</p></div>
    <div class="seg-sm" role="group" aria-label="Wariant dochodu"><button type="button" data-variant="A" aria-pressed="${VARIANT === 'A'}">Ostrożnie</button><button type="button" data-variant="B" aria-pressed="${VARIANT === 'B'}">Z premiami</button></div></div>
    <div class="figures">
      <div><span class="k">Na koniec ${D.year} zostanie</span><span class="v num">${zlR(D.yearEnd.leftA, D.yearEnd.leftB)}</span><span class="s">od stycznia do grudnia</span></div>
      <div><span class="k">Rezerwa na terminy</span><span class="v num">${zl(saveMonthly)}</span><span class="s">${nextDl ? 'miesięcznie, najbliższy: ' + esc(nextDl.name) : 'brak terminów'}</span></div>
      ${(() => { const f = (D.forecast || []).find(x => !x.isCurrent); if (!f) return ''; const lv = VARIANT === 'B' ? f.leftB : f.leftA; return `<div><span class="k">W przyszłym miesiącu ${lv < 0 ? 'zabraknie' : 'zostanie'}</span><span class="v num">${zl(Math.abs(lv))}</span><span class="s">${esc(D.monthNames[f.m] || f.label)}: dochód ${zl(VARIANT === 'B' ? f.incomeB : f.incomeA)}, wydatki ${zl(f.expenses)}</span></div>`; })()}
    </div></section>`;

  /* ================= PLAN: ile odłożysz ================= */
  if (D.savings && D.savings.points.length) {
    const S = D.savings;
    V.plan += `<section class="panel" aria-labelledby="h-sav"><h2 id="h-sav">Ile odłożysz</h2>
      <p class="desc">Ile przybędzie od ${esc(S.fromLabel)}, jeśli odłożysz wszystko, co zostaje z każdego miesiąca. Uwzględnia raty, terminy roczne i podatek.</p>
      <div class="sav-points">${S.points.map(pt => `<div data-sav="${pt.ymi}" role="button" tabindex="0"><span>do ${pt.date}</span><b class="num">+${zlR(pt.cumA, pt.cumB)}</b><small>${pt.quarter}</small></div>`).join('')}</div>
      <div class="sav-chart" id="savChart"></div>
      <div class="legend"><span><i class="sw line" style="background:var(--left)"></i>ostrożnie</span><span><i class="sw line" style="background:repeating-linear-gradient(90deg,var(--left) 0 3px,transparent 3px 6px)"></i>z premiami</span><span><i class="sw" style="background:var(--warning);border-radius:50%"></i>większy wydatek</span><span style="color:var(--muted)">Dotknij wykresu, żeby zobaczyć miesiąc.</span></div>
      <p class="total">Nie uwzględnia wakacji ani większych jednorazowych zakupów. Dodaj je w zakładce Terminy w arkuszu, a symulacja je odejmie.</p>
    </section>`;
  }

  /* ================= PLAN: prognoza ================= */
  let fcH = `<section class="panel" aria-labelledby="h-fc"><h2 id="h-fc">Prognoza na ${D.forecast.length} mies.</h2>
    <p class="desc">Typowy miesiąc z ostatnich danych, plus raty, terminy i podatek.</p>`;
  if (D.forecast.length) {
    const maxLeft = Math.max(1, ...D.forecast.map(f => Math.abs(VARIANT === 'B' ? f.leftB : f.leftA)));
    fcH += `<table><thead><tr><th>Miesiąc</th><th class="n">Dochód</th><th class="n">Wydatki</th><th class="n">Zostaje</th></tr></thead><tbody>`;
    D.forecast.forEach(f => {
      const lv = VARIANT === 'B' ? f.leftB : f.leftA;
      fcH += `<tr><td>${f.label}${f.isCurrent ? '<span class="now">teraz</span>' : ''}${f.items.length ? `<div class="items">${f.items.map(esc).join(', ')}</div>` : ''}</td>
        <td class="n num">${zlR(f.incomeA, f.incomeB)}</td><td class="n num">${zl(f.expenses)}</td>
        <td class="n num left${lv < 0 ? ' neg' : ''}">${zl(lv)}<i style="width:${Math.abs(lv) / maxLeft * 52}%"></i></td></tr>`;
    });
    const sumA = D.forecast.reduce((s, f) => s + f.leftA, 0), sumB = D.forecast.reduce((s, f) => s + f.leftB, 0);
    fcH += `</tbody></table><p class="total">W tym okresie zostanie około <b class="num" style="color:var(--text)">${zlR(sumA, sumB)}</b>.</p>`;
  } else fcH += `<p class="desc">Ten rok jest już zamknięty.</p>`;
  fcH += `</section>`;

  /* ================= PLAN: terminy ================= */
  let dueH = `<section class="panel" aria-labelledby="h-due"><h2 id="h-due">Terminy i wydatki roczne</h2>
    <p class="desc">Rezerwa to kwota, którą co miesiąc warto zostawić na koncie, żeby zebrać całość do terminu.</p>`;
  if (!D.deadlines.length) dueH += `<p class="desc">Nie ma terminów. Dodasz je w zakładce Terminy w arkuszu.</p>`;
  D.deadlines.forEach(d => {
    const col = d.daysLeft < 0 ? 'var(--muted)' : d.daysLeft <= 14 ? 'var(--critical)' : d.alert ? 'var(--warning)' : 'var(--income)';
    const progress = d.daysLeft < 0 ? 100 : Math.max(2, Math.min(100, 100 - d.daysLeft / 365 * 100));
    dueH += `<div class="due">
      <div class="row"><b>${esc(d.name)}</b><b class="num">${zl(d.amount)}</b></div>
      <div class="when">${fmtDate(d.date)}, ${d.daysLeft < 0 ? 'termin minął' : dni(d.daysLeft)}</div>
      <div class="track" style="height:5px;margin:8px 0 6px"><span data-w="${progress}" style="background:${col}"></span></div>
      ${d.daysLeft >= 0 ? `<div class="save">${d.monthsLeft > 0 ? `Rezerwa <b class="num">${zl(d.monthly)}</b> miesięcznie` : 'Do zapłaty w tym miesiącu'}</div>` : ''}
      ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
    </div>`;
  });
  if (D.commitments.length) dueH += `<div class="rates">${D.commitments.map(c => `<div><span>${esc(c.name)}, od ${c.from || '?'}${c.to ? ' do ' + c.to : ''}</span><span class="num">${zl(c.amount)}</span></div>`).join('')}</div>`;
  dueH += `</section>`;
  V.plan += `<div class="cols">${fcH}${dueH}</div>`;

  /* ================= PLAN: drugi próg podatkowy ================= */
  const T = D.tax;
  if (T) {
    const pct = Math.min(100, T.cumBase / T.threshold * 100);
    let msg;
    if (T.crossedIn) {
      msg = `Próg przekroczony przy wypłacie za <b>${esc(T.crossedIn.month.toLowerCase())}</b>. Do końca roku pensja podstawowa netto wynosi około <b class="num">${zl(T.netAboveA)}</b> zamiast ${zl(T.netA)}, czyli o <b class="num">${zl(T.dropA)}</b> mniej miesięcznie.`;
    } else if (T.crossA && T.crossA.year === D.year) {
      const diff = T.crossB && T.crossB.ymi !== T.crossA.ymi ? ` Przy premiach jak dotąd: już przy wypłacie za <b>${esc(T.crossB.month.toLowerCase())}</b>.` : '';
      msg = `Przekroczysz go przy wypłacie za <b>${esc(T.crossA.month.toLowerCase())}</b>.${diff} Od tej wypłaty podatek wynosi 32%: pensja netto spadnie z około ${zl(T.netA)} do około <b class="num">${zl(T.netAboveA)}</b>, czyli o <b class="num">${zl(T.dropA)}</b> miesięcznie. Do końca roku to łącznie około <b class="num">${zl(T.impactA)}</b> mniej na koncie. Od stycznia próg liczy się od zera.`;
    } else {
      msg = `W ${D.year} nie przekroczysz progu. Zapas: około <b class="num">${zl(T.threshold - T.cumBase)}</b> dochodu.`;
    }
    V.plan += `<section class="panel tax" aria-labelledby="h-tax"><h2 id="h-tax">Drugi próg podatkowy</h2>
      <p class="desc">${T.source === 'payslip' ? 'Na podstawie kwoty z paska wpisanej w Ustawieniach.' : `Szacunek z wpływów netto przy pensji ${zl(T.grossA)} brutto. Dokładniej będzie po wpisaniu podstawy z paska w Ustawieniach.`}</p>
      <div class="row"><span>Dochód do opodatkowania od stycznia</span><b class="num">około ${fmtN(T.cumBase)} z ${fmtN(T.threshold)} zł</b></div>
      <div class="track"><span data-w="${pct}" style="background:${pct >= 100 ? 'var(--warning)' : 'var(--income)'}"></span></div>
      <p class="tax-msg">${msg}</p>
    </section>`;
  }
  V.urzadzenia = `<div class="sub-head"><button type="button" class="linkish" data-goto="${PREV_TAB}">‹ Wróć</button><h1>Ustawienia</h1>
      <p>Urządzenia z dostępem do arkusza, przypomnienia o płatnościach i kolory kategorii.</p></div>` + devicesPanel() + remindersPanel() + colorsPanel() +
    `<section class="panel" aria-labelledby="h-acc"><h2 id="h-acc">Jak działa dostęp</h2><ul class="plain">
      <li>Każde urządzenie ma własną przepustkę. Usunięte traci dostęp od razu.</li>
      <li>Kolejne urządzenia łączysz 6-cyfrowym kodem, ważnym 5 minut i tylko raz.</li>
      <li>Główny klucz służy tylko do połączenia pierwszego urządzenia. Nowy tworzysz w Apps Script funkcją utworzKlucz.</li>
      <li>Awaryjnie funkcja odlaczWszystkieUrzadzenia w Apps Script odłącza wszystkie urządzenia naraz.</li>
    </ul><p class="total">Aplikacja v${CLIENT_VERSION}${D.version ? `, skrypt v${esc(D.version)}` : ''}.${D.sheetUrl ? ` <a href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">Otwórz arkusz</a>` : ''}</p></section>`;
  V.plan += `<footer>Jak liczę prognozę: dla każdej kategorii biorę medianę z ${D.baselineMonths} ostatnich pełnych miesięcy${D.usedPrevYear ? ' (łącznie z końcówką poprzedniego roku)' : ''}. Raty pochodzą z zakładki Ustawienia, wydatki roczne (OC/AC, przegląd) z zakładki Terminy. Wakacji nie prognozuję. Podatek: skala 12% i 32% powyżej 120 000 zł dochodu, ZUS 13,71%, zdrowotna 9%, kwota zmniejszająca 300 zł; limit 30-krotności ZUS pomijam.${D.streaming ? ` Abonamenty kosztują ${zl(D.streaming.lastMonth)} miesięcznie i są wliczone w Nieistotne.` : ''}<br>Wersja v${CLIENT_VERSION}${D.version && D.version !== CLIENT_VERSION ? ` (skrypt v${esc(D.version)})` : ''}.</footer>`;

  document.getElementById('app').innerHTML = Object.keys(V).map(k => `<div class="view" data-tabview="${k}"${k === TAB ? '' : ' hidden'}>${V[k]}</div>`).join('');

  /* ================= animacja pasków ================= */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  }));

  /* ================= struktura wydatków ================= */
  const tabs = [{ k: 'year', label: 'Cały rok' }];
  for (let m = lastIdx; m >= 0; m--) tabs.push({ k: m, label: D.monthShort[m] });
  let sel = CAT_SEL !== 'year' && CAT_SEL <= lastIdx ? CAT_SEL : 'year';
  const tabsEl = document.getElementById('catTabs'), listEl = document.getElementById('catList');
  const prevEl = document.getElementById('catPrev'), nextEl = document.getElementById('catNext');
  const syncArrows = () => {
    const max = tabsEl.scrollWidth - tabsEl.clientWidth;
    prevEl.toggleAttribute('data-off', tabsEl.scrollLeft <= 2);
    nextEl.toggleAttribute('data-off', tabsEl.scrollLeft >= max - 2);
  };
  const page = dir => tabsEl.scrollBy({ left: dir * Math.max(120, tabsEl.clientWidth * 0.7), behavior: 'smooth' });
  prevEl.onclick = () => page(-1); nextEl.onclick = () => page(1);
  tabsEl.addEventListener('scroll', syncArrows, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(syncArrows).observe(tabsEl);   // obserwator znika razem z elementem przy kolejnym render()
  function renderCats() {
    const keep = tabsEl.scrollLeft;
    tabsEl.innerHTML = tabs.map(tb => `<button type="button" data-k="${tb.k}" aria-pressed="${String(tb.k) === String(sel)}">${tb.label}</button>`).join('');
    const val = arr => sel === 'year' ? arr.slice(0, lastIdx + 1).reduce((a, b) => a + b, 0) : arr[sel];
    const rows = D.blocks.map(b => ({ b, v: val(b.perMonth) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
    const total = rows.reduce((s, r) => s + r.v, 0);
    const max = rows.length ? rows[0].v : 1;
    listEl.innerHTML = rows.map(r => {
      const subs = r.b.cols.map(c => ({ n: c.name, v: val(c.perMonth) })).filter(x => x.v !== 0).sort((a, b) => b.v - a.v);
      return `<details class="cat" data-cat="${r.b.id}"${OPEN_CATS.has(r.b.id) ? ' open' : ''}><summary><div class="row"><span><i class="dotc" style="background:${colorOf(r.b.id)}"></i>${esc(r.b.name)}<small>${Math.round(r.v / total * 100)}%</small><span class="chev" aria-hidden="true">▶</span></span><b class="num">${zl(r.v)}</b></div>
        <div class="bar"><span style="background:${colorOf(r.b.id)}" data-w="${r.v / max * 100}"></span></div></summary>
        <div class="subs">${subs.map(s => `<div><span>${esc(s.n)}</span><span class="num">${zl(s.v)}</span></div>`).join('')}</div></details>`;
    }).join('') + `<p class="total">Razem <b class="num" style="color:var(--text)">${zl(total)}</b>${sel === 'year' ? ' od początku roku' : ' w tym miesiącu'}.</p>`;
    requestAnimationFrame(() => listEl.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; }));
    tabsEl.scrollLeft = keep;
    tabsEl.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      sel = CAT_SEL = btn.dataset.k === 'year' ? 'year' : Number(btn.dataset.k); renderCats();
      const b = tabsEl.querySelector('[aria-pressed="true"]'); if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
    listEl.querySelectorAll('details[data-cat]').forEach(d => d.addEventListener('toggle', () => { if (d.open) OPEN_CATS.add(d.dataset.cat); else OPEN_CATS.delete(d.dataset.cat); }));
    syncArrows();
  }
  renderCats();
  drawVisible();
  }

  /* ================= wykres SVG: płynne krzywe (monotoniczny spline) ================= */
  // Fritsch–Carlson: krzywa gładka, ale bez „przestrzeliwania” ponad wartości z danych.
  function spline(pts) {
    const n = pts.length, dx = [], m = [], tg = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; m[i] = (pts[i + 1].y - pts[i].y) / dx[i]; }
    tg[0] = m[0]; tg[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { tg[i] = 0; tg[i + 1] = 0; continue; }
      const a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i]; }
    }
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1], d = dx[i] / 3;
      segs.push({ p0, c1: { x: p0.x + d, y: p0.y + tg[i] * d }, c2: { x: p1.x - d, y: p1.y - tg[i + 1] * d }, p1 });
    }
    return segs;
  }
  const f1 = v => v.toFixed(1);
  const fwd = (segs, a, b) => { let s = ''; for (let i = a; i < b; i++) { const g = segs[i]; s += `C${f1(g.c1.x)},${f1(g.c1.y)} ${f1(g.c2.x)},${f1(g.c2.y)} ${f1(g.p1.x)},${f1(g.p1.y)}`; } return s; };
  const back = (segs) => { let s = ''; for (let i = segs.length - 1; i >= 0; i--) { const g = segs[i]; s += `C${f1(g.c2.x)},${f1(g.c2.y)} ${f1(g.c1.x)},${f1(g.c1.y)} ${f1(g.p0.x)},${f1(g.p0.y)}`; } return s; };
  const lineTo = (pts, segs, a, b) => `M${f1(pts[a].x)},${f1(pts[a].y)}` + fwd(segs, a, b);
  const backRange = (segs, a, b) => { let s = ''; for (let i = b - 1; i >= a; i--) { const g = segs[i]; s += `C${f1(g.c2.x)},${f1(g.c2.y)} ${f1(g.c1.x)},${f1(g.c1.y)} ${f1(g.p0.x)},${f1(g.p0.y)}`; } return s; };

  let animated = false;

  function drawYear() {
    const box = document.getElementById('yearChart'), tip = document.getElementById('tip');
    if (!box || !box.clientWidth) return;   // zakładka ukryta – narysuje się po przełączeniu
    if (VIEW === 'structure') return drawStructure(box, tip);
    const ym = D.yearMonths;
    const W = box.clientWidth, H = box.clientHeight;
    const pad = { l: 46, r: 14, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxV = Math.max(...ym.map(x => Math.max(x.incomeA, x.incomeB, x.expenses)));
    const stepV = maxV > 12000 ? 5000 : 2500;
    const top = Math.ceil(maxV * 1.05 / stepV) * stepV;
    const X = i => pad.l + (iw * (i + 0.5)) / ym.length;
    const Y = v => pad.t + ih - (Math.max(0, v) / top) * ih;
    const inc = ym.map((x, i) => ({ x: X(i), y: Y(x.incomeA) }));       // wariant ostrożny
    const incB = ym.map((x, i) => ({ x: X(i), y: Y(x.incomeB) }));      // wariant ze średnią z premiami
    const exp = ym.map((x, i) => ({ x: X(i), y: Y(x.expenses) }));
    const sI = spline(inc), sIB = spline(incB), sE = spline(exp);
    const firstFc = ym.findIndex(x => x.status !== 'actual');
    const k = firstFc < 0 ? ym.length - 1 : Math.max(0, firstFc - 1); // ostatni punkt rzeczywisty
    const xSplit = firstFc < 0 ? W : (X(k) + X(firstFc)) / 2;
    const n = ym.length - 1;

    const band = `M${f1(inc[0].x)},${f1(inc[0].y)}` + fwd(sI, 0, n) + `L${f1(exp[n].x)},${f1(exp[n].y)}` + back(sE) + 'Z';
    const aboveInc = `M${f1(inc[0].x)},${f1(inc[0].y)}` + fwd(sI, 0, n) + `L${f1(inc[n].x)},${pad.t - 20}L${f1(inc[0].x)},${pad.t - 20}Z`;
    const belowInc = `M${f1(inc[0].x)},${f1(inc[0].y)}` + fwd(sI, 0, n) + `L${f1(inc[n].x)},${H}L${f1(inc[0].x)},${H}Z`;

    let grid = '';
    for (let v = 0; v <= top; v += stepV) {
      grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="var(--grid)" stroke-width="1"/>` +
        `<text x="${pad.l - 8}" y="${f1(Y(v) + 4)}" text-anchor="end" fill="var(--muted)" font-size="12">${v ? Math.round(v / 1000) + ' tys.' : '0'}</text>`;
    }
    const labels = ym.map((x, i) => `<text x="${f1(X(i))}" y="${H - 6}" text-anchor="middle" fill="${i === D.currentMonth ? 'var(--text)' : 'var(--muted)'}" font-size="12" font-weight="${i === D.currentMonth ? 700 : 500}">${x.label}</text>`).join('');
    const fcShade = firstFc < 0 ? '' : `<rect x="${f1(xSplit)}" y="${pad.t}" width="${f1(W - pad.r - xSplit)}" height="${ih}" fill="#ffffff" opacity=".018"/>`;
    const lines = (pts, segs, color) =>
      `<path d="${lineTo(pts, segs, 0, k)}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round"/>` +
      (k < n ? `<path d="${lineTo(pts, segs, k, n)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity=".75"/>` : '');
    const dots = (pts, color) => pts.map((p, i) => i <= k ? `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="2"/>` : '').join('');
    // pasmo dochodu w prognozie: między wariantem ostrożnym a średnim
    const hasB = k < n && ym.slice(k).some(x => Math.abs(x.incomeB - x.incomeA) > 1);
    const incBand = hasB ? `<path d="M${f1(incB[k].x)},${f1(incB[k].y)}${fwd(sIB, k, n)}L${f1(inc[n].x)},${f1(inc[n].y)}${backRange(sI, k, n)}Z" fill="var(--income)" opacity=".13"/>` +
      `<path d="${lineTo(incB, sIB, k, n)}" fill="none" stroke="var(--income)" stroke-width="1.6" stroke-dasharray="2 5" stroke-linecap="round" opacity=".7"/>` : '';
    // drugi próg podatkowy: pionowa linia w miesiącu przekroczenia
    const marks = [];
    ym.forEach((x, i) => { if (x.crossA) marks.push({ i, t: 'II próg' }); else if (x.crossB) marks.push({ i, t: 'II próg (średnio)' }); });
    const taxMarks = marks.map(mk => `<line x1="${f1(X(mk.i))}" x2="${f1(X(mk.i))}" y1="${pad.t + 14}" y2="${pad.t + ih}" stroke="var(--warning)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".85"/>` +
      `<text x="${f1(Math.min(X(mk.i), W - pad.r - 30))}" y="${pad.t + 9}" text-anchor="middle" fill="var(--warning)" font-size="12" font-weight="700">${mk.t}</text>`).join('');

    box.querySelector('svg') && box.querySelector('svg').remove();
    box.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dochód i wydatki w poszczególnych miesiącach ${D.year}">
      <defs>
        <clipPath id="cAbove"><path d="${aboveInc}"/></clipPath>
        <clipPath id="cBelow"><path d="${belowInc}"/></clipPath>
        <clipPath id="reveal"><rect id="revealRect" x="0" y="0" width="${animated || reduceMotion ? W : 0}" height="${H}"/></clipPath>
        <mask id="fcMask"><rect x="0" y="0" width="${f1(xSplit)}" height="${H}" fill="#fff"/><rect x="${f1(xSplit)}" y="0" width="${W}" height="${H}" fill="#5a5a5a"/></mask>
        <linearGradient id="gLeft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--left)" stop-opacity=".55"/><stop offset="1" stop-color="var(--left)" stop-opacity=".18"/></linearGradient>
        <linearGradient id="gDef" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--deficit)" stop-opacity=".65"/><stop offset="1" stop-color="var(--deficit)" stop-opacity=".3"/></linearGradient>
      </defs>
      ${grid}${fcShade}
      <g clip-path="url(#reveal)">
        <g mask="url(#fcMask)">
          <path d="${band}" fill="url(#gLeft)" clip-path="url(#cBelow)"/>
          <path d="${band}" fill="url(#gDef)" clip-path="url(#cAbove)"/>
        </g>
        ${incBand}${lines(exp, sE, 'var(--expense)')}${lines(inc, sI, 'var(--income)')}
        ${dots(exp, 'var(--expense)')}${dots(inc, 'var(--income)')}
      </g>
      ${labels}${taxMarks}
      <g id="hover" style="display:none">
        <line id="hvLine" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--text-2)" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>
        <circle id="hvI" r="5" fill="var(--income)" stroke="var(--bg)" stroke-width="2"/>
        <circle id="hvE" r="5" fill="var(--expense)" stroke="var(--bg)" stroke-width="2"/>
      </g>
      <rect x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent" id="hit"/>
    </svg>`);

    if (!animated && !reduceMotion) {
      animated = true;
      const r = document.getElementById('revealRect'), t0 = performance.now(), dur = 1100;
      const step = now => { const p = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - p, 3); r.setAttribute('width', W * e); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    animated = true;

    /* podpowiedź: najechanie myszą albo przesunięcie palcem */
    const hit = document.getElementById('hit'), hv = document.getElementById('hover');
    const show = ev => {
      const rect = box.getBoundingClientRect();
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = Math.max(0, Math.min(n, Math.round((x - pad.l) / (iw / ym.length) - 0.5)));
      const d = ym[i];
      hv.style.display = '';
      document.getElementById('hvLine').setAttribute('x1', X(i)); document.getElementById('hvLine').setAttribute('x2', X(i));
      document.getElementById('hvI').setAttribute('cx', X(i)); document.getElementById('hvI').setAttribute('cy', Y(d.incomeA));
      document.getElementById('hvE').setAttribute('cx', X(i)); document.getElementById('hvE').setAttribute('cy', Y(d.expenses));
      const fc = d.status !== 'actual';
      tip.innerHTML = `<div class="t">${D.monthNames[i]}${fc ? ' <em>' + (d.status === 'current' ? 'w trakcie, prognoza' : 'prognoza') + '</em>' : ''}</div>
        <div class="r"><span><i class="sw line" style="background:var(--income)"></i>Dochód</span><span class="num">${zlR(d.incomeA, d.incomeB)}</span></div>
        <div class="r"><span><i class="sw line" style="background:var(--expense)"></i>Wydatki</span><span class="num">${zl(d.expenses)}</span></div>
        <div class="r"><span><i class="sw" style="background:${d.leftA < 0 ? 'var(--deficit)' : 'var(--left)'}"></i>${d.leftA < 0 ? 'Brakuje' : 'Zostaje'}</span><span class="num">${d.leftA < 0 && d.leftB < 0 ? zlR(-d.leftA, -d.leftB) : zlR(d.leftA, d.leftB)}</span></div>
        ${d.crossA || d.crossB ? '<div class="tax-line">Drugi próg podatkowy w tym miesiącu</div>' : ''}
        <div class="hint">Dotknij, żeby zobaczyć szczegóły</div>`;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, X(i) + (X(i) > W / 2 ? -tw - 14 : 14))) + 'px';
      tip.classList.add('on');
    };
    const hide = () => { hv.style.display = 'none'; tip.classList.remove('on'); };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('touchmove', show, { passive: true });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('click', ev => {
      const rect = box.getBoundingClientRect();
      const i = Math.max(0, Math.min(n, Math.round((ev.clientX - rect.left - pad.l) / (iw / ym.length) - 0.5)));
      hide(); openDetail(i);
    });
    hit.addEventListener('touchend', () => setTimeout(hide, 1800));
  }

  /* ================= wykres: struktura wydatków (skumulowane kolumny) + linia dochodu ================= */
  const roundTop = (x, y, w, h, r) => { r = Math.min(r, h, w / 2); return `M${f1(x)},${f1(y + h)}V${f1(y + r)}Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)}H${f1(x + w - r)}Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)}V${f1(y + h)}Z`; };
  function monthStack(i, toDate) {
    const x = D.yearMonths[i], real = x.status === 'actual' || (toDate && x.status === 'current');
    const segs = BLOCK_ORDER.filter(id => D.blocks.some(b => b.id === id)).map(id => {
      const b = D.blocks.find(bb => bb.id === id);
      return { id, name: b.name, v: Math.max(0, real ? b.perMonth[i] : ((x.byBlock || {})[id] || 0)) };
    });
    const sum = segs.reduce((a, g) => a + g.v, 0);
    if (!real && x.expenses - sum > 1) segs.push({ id: 'other', name: 'Terminy roczne', v: x.expenses - sum });
    return { segs, total: segs.reduce((a, g) => a + g.v, 0) };
  }
  function drawStructure(box, tip) {
    const ym = D.yearMonths;
    const W = box.clientWidth, H = box.clientHeight;
    const pad = { l: 46, r: 14, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const n = ym.length - 1;
    const stacks = ym.map((x, i) => {
      const st = monthStack(i);
      if (!ISO) return st;
      const segs = st.segs.filter(g => g.id === ISO);
      return { segs, total: segs.reduce((a, g) => a + g.v, 0) };
    });
    const maxV = ISO ? Math.max(1, ...stacks.map(st => st.total)) : Math.max(...ym.map((x, i) => Math.max(x.incomeA, x.incomeB, stacks[i].total)));
    const stepV = maxV > 12000 ? 5000 : maxV > 6000 ? 2500 : maxV > 2400 ? 1000 : maxV > 1200 ? 500 : maxV > 600 ? 200 : 100;
    const top = Math.ceil(maxV * 1.12 / stepV) * stepV;
    const X = i => pad.l + (iw * (i + 0.5)) / ym.length;
    const Y = v => pad.t + ih - (Math.max(0, v) / top) * ih;
    const bw = Math.max(10, Math.min(50, iw / ym.length * 0.72));
    const tick = v => v >= 1000 ? (v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' tys.' : v + ' zł';
    const firstFc = ym.findIndex(x => x.status !== 'actual');
    const k = firstFc < 0 ? n : Math.max(0, firstFc - 1);

    let grid = '';
    for (let v = 0; v <= top; v += stepV) {
      grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="var(--grid)" stroke-width="1"/>` +
        `<text x="${pad.l - 8}" y="${f1(Y(v) + 4)}" text-anchor="end" fill="var(--muted)" font-size="12">${v ? tick(v) : '0'}</text>`;
    }
    const labels = ym.map((x, i) => `<text x="${f1(X(i))}" y="${H - 6}" text-anchor="middle" fill="${i === D.currentMonth ? 'var(--text)' : 'var(--muted)'}" font-size="12" font-weight="${i === D.currentMonth ? 700 : 500}">${x.label}</text>`).join('');
    // kolumny: segmenty od dołu, lekko przezroczyste, bez przerw i obrysów; zaokrąglona tylko góra
    const showTotals = bw >= 24 || !!ISO;
    const cols = stacks.map((st, i) => {
      const op = ym[i].status === 'actual' ? 1 : ym[i].status === 'current' ? 0.75 : 0.45;
      let yCur = Y(0), out = '';
      const vis = st.segs.filter(g => g.v / top * ih >= 0.8);
      vis.forEach((g, j) => {
        const hgt = g.v / top * ih;
        const y = yCur - hgt;
        out += j === vis.length - 1
          ? `<path d="${roundTop(X(i) - bw / 2, y, bw, hgt, 5)}" fill="${colorOf(g.id)}" fill-opacity=".8"/>`
          : `<rect x="${f1(X(i) - bw / 2)}" y="${f1(y)}" width="${f1(bw)}" height="${f1(hgt + 0.5)}" fill="${colorOf(g.id)}" fill-opacity=".8"/>`;
        yCur = y;
      });
      const lbl = showTotals && st.total > 0
        ? `<text x="${f1(X(i))}" y="${f1(Y(st.total) - 6)}" text-anchor="middle" fill="var(--text-2)" font-size="${W < 600 ? 9.5 : 11}" font-weight="600">${ISO ? fmtN(st.total) : (st.total / 1000).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</text>` : '';
      return `<g class="scol" data-op="${op}" opacity="${op}">${out}${lbl}</g>`;
    }).join('');
    // dochód: wariant ostrożny (linia ciągła w danych, przerywana w prognozie) i średni (kropkowany)
    const inc = ym.map((x, i) => ({ x: X(i), y: Y(x.incomeA) }));
    const incB = ym.map((x, i) => ({ x: X(i), y: Y(x.incomeB) }));
    const sI = spline(inc), sIB = spline(incB);
    const hasB = k < n && ym.slice(k).some(x => Math.abs(x.incomeB - x.incomeA) > 1);
    const incLine = `<path d="${lineTo(inc, sI, 0, k)}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linecap="round" opacity=".9"/>` +
      (k < n ? `<path d="${lineTo(inc, sI, k, n)}" fill="none" stroke="var(--text)" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity=".7"/>` : '') +
      (hasB ? `<path d="${lineTo(incB, sIB, k, n)}" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round" opacity=".55"/>` : '') +
      inc.map((p, i) => i <= k ? `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="3.5" fill="var(--text)" stroke="var(--surface)" stroke-width="2"/>` : '').join('');
    const marks = [];
    ym.forEach((x, i) => { if (x.crossA) marks.push({ i, t: 'II próg' }); else if (x.crossB) marks.push({ i, t: 'II próg (średnio)' }); });
    const taxMarks = marks.map(mk => `<line x1="${f1(X(mk.i) + bw / 2 + 4)}" x2="${f1(X(mk.i) + bw / 2 + 4)}" y1="${pad.t + 14}" y2="${pad.t + ih}" stroke="var(--warning)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".85"/>` +
      `<text x="${f1(Math.min(X(mk.i), W - pad.r - 30))}" y="${pad.t + 9}" text-anchor="middle" fill="var(--warning)" font-size="12" font-weight="700">${mk.t}</text>`).join('');

    box.querySelector('svg') && box.querySelector('svg').remove();
    box.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Struktura wydatków i dochód w poszczególnych miesiącach ${D.year}">
      <defs><clipPath id="reveal"><rect id="revealRect" x="0" y="0" width="${animated || reduceMotion ? W : 0}" height="${H}"/></clipPath></defs>
      ${grid}
      <g clip-path="url(#reveal)">${cols}${ISO ? '' : incLine}</g>
      ${labels}${taxMarks}
      <rect id="hvCol" x="0" y="${pad.t}" width="${f1(bw + 8)}" height="${ih}" rx="6" fill="none" stroke="var(--text-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <rect x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent" id="hit"/>
    </svg>`);
    if (!animated && !reduceMotion) {
      animated = true;
      const r = document.getElementById('revealRect'), t0 = performance.now(), dur = 1000;
      const step = now => { const p = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - p, 3); r.setAttribute('width', W * e); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    animated = true;

    const hit = document.getElementById('hit'), hv = document.getElementById('hvCol');
    const idxAt = clientX => Math.max(0, Math.min(n, Math.round((clientX - box.getBoundingClientRect().left - pad.l) / (iw / ym.length) - 0.5)));
    const show = ev => {
      const i = idxAt(ev.touches ? ev.touches[0].clientX : ev.clientX);
      const d = ym[i], st = stacks[i];
      hv.setAttribute('x', f1(X(i) - bw / 2 - 4)); hv.setAttribute('opacity', '0');
      box.querySelectorAll('.scol').forEach((g, j) => g.setAttribute('opacity', j === i ? g.dataset.op : g.dataset.op * 0.35));
      const fc = d.status !== 'actual';
      const rows = st.segs.filter(g => g.v > 0).sort((a, c) => c.v - a.v);
      tip.innerHTML = `<div class="t">${D.monthNames[i]}${fc ? ' <em>' + (d.status === 'current' ? 'w trakcie, prognoza' : 'prognoza') + '</em>' : ''}</div>
        ${ISO ? '' : `<div class="r"><span><i class="sw line" style="background:var(--text)"></i>Dochód</span><span class="num">${zlR(d.incomeA, d.incomeB)}</span></div>`}
        ${rows.map(g => `<div class="r"><span><i class="sw" style="background:${colorOf(g.id)}"></i>${esc(g.name)}</span><span class="num">${zl(g.v)}</span></div>`).join('')}
        <div class="r" style="border-top:1px solid var(--line);margin-top:3px;padding-top:3px"><span>${ISO ? 'Razem w bloku' : 'Wydatki razem'}</span><span class="num">${zl(st.total)}</span></div>
        ${d.crossA || d.crossB ? '<div class="tax-line">Drugi próg podatkowy w tym miesiącu</div>' : ''}
        <div class="hint">Dotknij, żeby zobaczyć szczegóły</div>`;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, X(i) + (X(i) > W / 2 ? -tw - bw : bw))) + 'px';
      tip.classList.add('on');
    };
    const hide = () => { hv.setAttribute('opacity', '0'); tip.classList.remove('on'); box.querySelectorAll('.scol').forEach(g => g.setAttribute('opacity', g.dataset.op)); };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('touchmove', show, { passive: true });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('touchend', () => setTimeout(hide, 1800));
    hit.addEventListener('click', ev => { const i = idxAt(ev.clientX); hide(); openDetail(i); });
  }

  /* ================= komunikacja z Apps Script ================= */
  const call = (fn, arg) => window.api(fn, arg);
  function applyModel(model) {
    if (!model) return;
    const y = window.scrollY;
    D = model; render(); renderRecent();
    window.scrollTo(0, y);
    if (window.saveCache) window.saveCache(model);
  }

  /* ================= komunikat z cofnięciem ================= */
  const toastEl = document.getElementById('toast');
  let toastTimer;
  function toast(html, undoId) {
    toastEl.innerHTML = `<div>${html}</div>${undoId ? `<button type="button" data-undo-toast="${esc(undoId)}">Cofnij</button>` : ''}`;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), undoId ? 7000 : 3500);
  }
  async function undo(id) {
    if (String(id).indexOf('q:') === 0) {   // jeszcze w kolejce na tym urządzeniu
      const cid = id.slice(2), list = readOutbox();
      if (list.some(x => x.cid === cid)) { writeOutbox(list.filter(x => x.cid !== cid)); rerender(); toast('Wpis usunięty, zanim trafił do arkusza.'); return; }
      id = 'K' + cid;   // zdążył się zapisać – cofamy w arkuszu
    }
    try {
      const r = await call('undoEntry', id);
      if (!r.ok) { toast(esc(r.error)); return; }
      applyModel(r.model); renderRecent();
      toast('Wpis cofnięty. Arkusz wrócił do poprzedniej wartości.');
    } catch (e) { toast('Nie udało się cofnąć: ' + esc(e.message || e)); }
  }
  toastEl.addEventListener('click', e => {
    const b = e.target.closest('[data-undo-toast]');
    if (b) { b.disabled = true; toastEl.classList.remove('on'); undo(b.dataset.undoToast); }
  });
  /* ================= okna wysuwane od dołu (wspólne) ================= */
  const $ = id => document.getElementById(id);
  const bg = $('sheetBg');
  let openEl = null, lastFocus = null;
  function showSheet(el) {
    if (openEl && openEl !== el) { openEl.classList.remove('open'); openEl.hidden = true; }
    else lastFocus = document.activeElement;
    openEl = el;
    el.hidden = false; bg.hidden = false;
    el.scrollTop = 0;
    requestAnimationFrame(() => { el.classList.add('open'); bg.classList.add('open'); });
    document.body.style.overflow = 'hidden';
  }
  function hideSheet() {
    const el = openEl;
    if (!el) return;
    openEl = null;
    el.classList.remove('open'); bg.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { if (openEl !== el) el.hidden = true; if (!openEl) bg.hidden = true; }, reduceMotion ? 0 : 300);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  bg.addEventListener('click', hideSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openEl) hideSheet(); });
  document.querySelectorAll('.sheet [data-close], #sheetClose').forEach(b => b.addEventListener('click', hideSheet));

  /* ================= formularz wpisu ================= */
  const sheet = $('sheet'), amountEl = $('amount'), dateEl = $('date'), descEl = $('desc'),
    unpaidEl = $('unpaid'), saveEl = $('save'), errEl = $('err'), selEl = $('catSelect');
  const F = { kind: 'expense', key: '', other: false, payment: null, edit: null, busy: false };
  const OTHER_ORDER = ['wazne', 'nieistotne', 'mieszkanie', 'tbs', 'auto', 'wakacje'];
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const catByKey = k => (D.categories || []).find(c => c.key === k && c.kind === 'expense');
  const inflowByKey = k => (D.inflows || []).find(x => x.key === k);
  const targetLabel = () => {
    if (F.payment) return F.payment.name;
    if (F.kind === 'income') { const f = inflowByKey(F.key); return f ? f.label : ''; }
    const c = catByKey(F.key); return c ? labelFor(c.block, c.col) : '';
  };

  function parseAmount(raw) {
    const s = String(raw || '').replace(/\s/g, '').replace(/,/g, '.');
    if (!s) return null;
    const parts = s.split('+');
    if (parts.some(p => !/^-?\d*\.?\d+$/.test(p))) return NaN;
    return Math.round(parts.reduce((a, p) => a + parseFloat(p), 0) * 100) / 100;
  }

  function buildPickers() {
    $('quick').innerHTML = (D.quick || []).map(q =>
      `<button type="button" data-key="${esc(q.key)}" aria-pressed="false"><i aria-hidden="true">${esc(q.icon || '•')}</i>${esc(q.label)}</button>`).join('');
    $('inflowQuick').innerHTML = (D.inflows || []).map(q =>
      `<button type="button" data-key="${esc(q.key)}" aria-pressed="false"><i aria-hidden="true">${esc(q.icon || '•')}</i>${esc(q.label)}</button>`).join('');
    const oc = (D.otherCols || []).slice().sort((a, c) => OTHER_ORDER.indexOf(a.blockId) - OTHER_ORDER.indexOf(c.blockId));
    $('otherChips').innerHTML = oc.map(o => `<button type="button" data-key="${esc(o.key)}" aria-pressed="false"><i class="dotc" style="background:${colorOf(o.blockId)}"></i>${esc(o.block)}</button>`).join('');
    const groups = {};
    (D.categories || []).filter(c => c.kind === 'expense').forEach(c => { (groups[c.block] = groups[c.block] || []).push(c); });
    selEl.innerHTML = '<option value="">Wybierz z listy…</option>' + Object.keys(groups).map(g =>
      `<optgroup label="${esc(g)}">${groups[g].map(c => `<option value="${esc(c.key)}">${esc(pretty(c.col))}</option>`).join('')}</optgroup>`).join('');
    syncPickers();
  }
  function syncPickers() {
    $('quick').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(F.kind === 'expense' && (b.dataset.key === '*' ? F.other : !F.other && b.dataset.key === F.key))));
    $('otherPick').hidden = !(F.kind === 'expense' && F.other);
    $('otherChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === F.key)));
    descEl.placeholder = F.other ? 'Co kupiłeś? np. żarówki, prezent' : 'np. Biedronka, pizza, Orlen';
    $('inflowQuick').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(F.kind === 'income' && b.dataset.key === F.key)));
    const inQuick = F.other || (D.quick || []).some(q => q.key === F.key);
    selEl.value = F.kind === 'expense' && F.key && !inQuick ? F.key : '';
    selEl.classList.toggle('picked', !!selEl.value);
    const f = F.kind === 'income' && inflowByKey(F.key);
    $('inflowNote').textContent = f ? (f.sign < 0 ? 'Kwota trafi z minusem do kolumny „' + f.category.split(' / ').pop() + '” i zmniejszy koszty tego bloku.' : 'Kwota zostanie dopisana do kolumny „' + pretty(f.category.split(' / ').pop()) + '” w miesiącu wpływu.') : '';
  }
  function setKind(kind) {
    F.kind = kind;
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    $('expensePick').hidden = kind !== 'expense';
    $('incomePick').hidden = kind !== 'income';
    $('unpaid').closest('.check').hidden = kind === 'income';
    F.key = kind === 'income' ? ((D.inflows || [])[0] || {}).key || '' : '';
    F.other = false;
    $('sheetTitle').textContent = kind === 'income' ? 'Nowy wpływ' : 'Nowy wydatek';
    syncPickers(); update();
  }
  function setDate(v) {
    dateEl.value = v;
    document.querySelectorAll('.dates button').forEach(b => b.setAttribute('aria-pressed', String(daysAgo(+b.dataset.ago) === v)));
    update();
  }
  function update() {
    const a = parseAmount(amountEl.value);
    const hint = $('amountHint');
    if (a === null) hint.textContent = 'Kilka kwot naraz? Wpisz np. 12,50+30.';
    else if (isNaN(a)) hint.textContent = 'Tej kwoty nie rozumiem. Użyj cyfr, przecinka i ewentualnie plusa.';
    else hint.textContent = /\+/.test(amountEl.value) ? 'Razem ' + zlc(a) : '';
    if (F.payment && F.payment.credit > 0 && a !== null && !isNaN(a)) {
      const used = Math.min(F.payment.credit, a);
      hint.textContent = `Faktura ${zlc(a)}, z nadpłaty ${zlc(used)}, do przelewu ${zlc(Math.max(0, a - used))}.`;
    }
    const d = dateEl.value;
    let mh = '';
    if (d) {
      const [y, m] = d.split('-').map(Number);
      mh = 'Trafi do miesiąca: ' + D.monthNames[m - 1].toLowerCase() + (y !== D.year ? ' ' + y : '');
      if (d > iso(new Date())) mh = 'Data jest w przyszłości. Sprawdź ją.';
    }
    $('monthHint').textContent = mh;
    const name = targetLabel();
    const ok = name && a !== null && !isNaN(a) && a !== 0 && !(F.kind === 'income' && a < 0) && d && d <= iso(new Date()) && !F.busy;
    saveEl.disabled = !ok;
    if (F.busy) saveEl.textContent = 'Zapisuję…';
    else if (!name) saveEl.textContent = F.kind === 'income' ? 'Wybierz rodzaj wpływu' : F.other ? 'Wybierz blok dla „Różne”' : 'Wybierz kategorię i wpisz kwotę';
    else if (a === null || isNaN(a) || a === 0) saveEl.textContent = 'Wpisz kwotę: ' + name;
    else if (F.edit) saveEl.textContent = 'Zapisz zmiany: ' + zlc(a) + ', ' + name;
    else if (F.payment) saveEl.textContent = 'Zapłacone ' + zlc(F.payment.credit > 0 ? Math.max(0, a - F.payment.credit) : a) + ': ' + name;
    else saveEl.textContent = (F.kind === 'income' ? 'Dopisz ' : 'Dodaj ') + zlc(a) + ': ' + name;
  }
  function renderRecent() {
    const r = allEntries().filter(e => !e.undone).slice(0, 3);
    $('recent').innerHTML = r.length ? '<div><span>Ostatnio dodane</span></div>' + r.map(e =>
      `<div><span>${fmtShort(e.date)}, ${esc(entryLabel(e))}${e.desc ? ', ' + esc(e.desc) : ''}</span><b class="num">${e.kind === 'wpływ' ? '+' : ''}${zlc(e.amount)}</b></div>`).join('') : '';
  }
  function openSheet() {
    if (F.edit) { setEditMode(null); setKind('expense'); amountEl.value = ''; descEl.value = ''; unpaidEl.checked = false; saveEl.hidden = false; setDate(iso(new Date())); }
    if (F.payment) { setPayMode(null); setKind('expense'); amountEl.value = ''; descEl.value = ''; }
    buildPickers(); renderRecent();
    if (!dateEl.value) setDate(iso(new Date()));
    dateEl.max = iso(new Date());
    errEl.textContent = '';
    showSheet(sheet);
    update();
  }
  $('fab').addEventListener('click', openSheet);
  document.addEventListener('click', e => { if (e.target.closest('[data-entry-new]')) openSheet(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b || b.dataset.view === VIEW) return;
    VIEW = b.dataset.view;
    store('finanse.view', VIEW);
    animated = false; const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
  const pickAndFocus = key => {
    F.key = key; syncPickers(); update();
    amountEl.focus({ preventScroll: true });
    // kwota na górę widoku: pod nią opis, „niezapłacone” i przycisk – widoczne nad klawiaturą
    const top = amountEl.closest('.amount').offsetTop - 12;
    sheet.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  $('quick').addEventListener('click', e => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    if (b.dataset.key === '*') { F.other = true; F.key = ''; syncPickers(); update(); return; }   // „Różne”: najpierw wybór bloku
    F.other = false; pickAndFocus(b.dataset.key);
  });
  $('otherChips').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (b) pickAndFocus(b.dataset.key); });
  $('inflowQuick').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (b) pickAndFocus(b.dataset.key); });
  selEl.addEventListener('change', () => { F.key = selEl.value; F.other = false; syncPickers(); update(); if (F.key) amountEl.focus(); });
  amountEl.addEventListener('input', update);
  amountEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!saveEl.disabled) save(); else amountEl.blur(); } });
  dateEl.addEventListener('change', () => setDate(dateEl.value));
  document.querySelectorAll('.dates button').forEach(b => b.addEventListener('click', () => setDate(daysAgo(+b.dataset.ago))));
  saveEl.addEventListener('click', save);

  async function save() {
    const name = targetLabel(), amount = parseAmount(amountEl.value);
    if (!name || !amount) return;
    const key = F.key, kind = F.kind;
    if (F.edit) return saveEdit(name, amount);
    // Zapis natychmiastowy: wpis trafia do kolejki na tym urządzeniu i wysyła się w tle (także po powrocie internetu).
    const pay = F.payment;
    const cid = newCid();
    const payload = { key: key, amount: amount, date: dateEl.value, desc: descEl.value, unpaid: kind === 'expense' && !pay && unpaidEl.checked, kind: kind, clientId: cid };
    if (pay) { payload.paymentRow = pay.row; payload.paymentName = pay.name; payload.period = pay.period; }
    const list = readOutbox(); list.push({ cid, payload, label: pay ? pay.name : name, payment: pay ? pay.name : '', at: Date.now() }); writeOutbox(list);
    const offline = navigator.onLine === false;
    const used = pay && pay.credit > 0 ? Math.min(pay.credit, amount) : 0;
    toast(`${pay ? 'Zapłacone' : kind === 'income' ? 'Dopisano' : 'Dodano'} ${zlc(Math.round((amount - used) * 100) / 100)}: ${esc(pay ? pay.name : name)}${used ? `<small>faktura ${zlc(amount)}, z nadpłaty ${zlc(used)}</small>` : ''}<small>${offline ? 'Brak internetu: zapiszę w arkuszu, gdy wróci połączenie.' : 'Zapisuję w arkuszu…'}</small>`, 'q:' + cid);
    amountEl.value = ''; descEl.value = ''; unpaidEl.checked = false;
    if (pay) { hideSheet(); setPayMode(null); F.key = ''; }
    else if (kind === 'expense') { F.key = ''; F.other = false; }
    buildPickers(); renderRecent(); rerender(); update();
    flushOutbox();
  }

  /* ---- edycja wpisu: ten sam formularz w trybie „Zmień wpis” ---- */
  function setEditMode(e) {
    F.edit = e || null;
    $('kindSeg').hidden = !!e;
    $('delEntry').hidden = !e;
    $('delEntry').textContent = 'Usuń wpis'; delete $('delEntry').dataset.armed;
    $('editNote').hidden = !(e && e.note);
    $('editNote').textContent = e && e.note ? e.note : '';
    $('recent').hidden = !!e;
  }
  function keyForEntry(e) {
    if (e.kind === 'wpływ') { const f = (D.inflows || []).find(x => x.category === e.category); return f ? f.key : ''; }
    const c = (D.categories || []).find(x => x.kind === 'expense' && x.block + ' / ' + x.col === e.category);
    return c ? c.key : '';
  }
  function openEntry(id) {
    let e, payload = null;
    if (id.indexOf('q:') === 0) {
      const it = readOutbox().find(x => 'q:' + x.cid === id);
      if (!it) return;
      payload = it.payload;
      e = { id, pending: true, queued: it, kind: payload.kind === 'income' ? 'wpływ' : 'wydatek', key: payload.key, amount: payload.amount, date: payload.date, desc: payload.desc || '', unpaid: !!payload.unpaid,
        note: it.error ? 'Nie zapisano w arkuszu: ' + it.error + ' Popraw wpis i zapisz ponownie albo go usuń.' : 'Ten wpis czeka na wysłanie do arkusza.' };
      if (it.payment) e.note = (e.note ? e.note + ' ' : '') + 'To zapłata „' + it.payment + '”.';
    } else {
      const x = (D.entries || []).find(y => y.id === id);
      if (!x) return;
      if (x.undone) { toast(x.edited ? 'Ten wpis został zmieniony. Nowa wersja jest wyżej na liście.' : 'Ten wpis jest cofnięty.'); return; }
      e = Object.assign({}, x, { key: keyForEntry(x) });
      if (x.credit) e.note = 'Zapłata z nadpłatą (' + zlc(x.credit) + '). Taki wpis można tylko usunąć i zapłacić ponownie.';
      else if (x.payment) e.note = 'Zapłata „' + x.payment + '”. Kwota zostaje w miesiącu tej płatności.';
      if (!e.key) e.note = 'Tej kategorii nie ma już w arkuszu. Wpis można tylko usunąć.';
    }
    setPayMode(null);
    F.kind = e.kind === 'wpływ' ? 'income' : 'expense';
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === F.kind)));
    $('expensePick').hidden = F.kind !== 'expense'; $('incomePick').hidden = F.kind !== 'income';
    $('unpaid').closest('.check').hidden = F.kind === 'income';
    F.key = e.key || ''; F.other = false;
    buildPickers();
    setEditMode(e);
    $('sheetTitle').textContent = e.pending ? 'Wpis w kolejce' : 'Zmień wpis';
    amountEl.value = String(e.amount).replace('.', ',');
    descEl.value = e.desc || ''; unpaidEl.checked = !!e.unpaid;
    setDate(e.date || iso(new Date()));
    dateEl.max = iso(new Date());
    errEl.textContent = '';
    const locked = !!(e.credit || (!e.pending && !e.key));
    saveEl.hidden = locked;
    showSheet(sheet);
    update();
  }
  async function saveEdit(name, amount) {
    const e = F.edit;
    const fields = { key: F.key, amount, date: dateEl.value, desc: descEl.value, unpaid: F.kind === 'expense' && unpaidEl.checked };
    if (e.pending) {
      const list = readOutbox(), it = list.find(x => 'q:' + x.cid === e.id);
      if (it) { Object.assign(it.payload, fields); it.label = name; delete it.error; writeOutbox(list); }
      hideSheet(); setEditMode(null); rerender(); toast('Wpis poprawiony. Zapisuję w arkuszu…'); flushOutbox();
      return;
    }
    F.busy = true; errEl.textContent = ''; update();
    try {
      const r = await call('editEntry', Object.assign({ id: e.id }, fields));
      if (!r.ok) { errEl.textContent = r.error; return; }
      hideSheet(); setEditMode(null);
      applyModel(r.model);
      toast(`Zmieniono wpis: ${zlc(r.entry.amount)}, ${esc(name)}.`, r.entry.id);
    } catch (err) { errEl.textContent = 'Nie udało się zapisać zmian: ' + (err.message || err); }
    finally { F.busy = false; update(); }
  }
  $('delEntry').addEventListener('click', async () => {
    const b = $('delEntry'), e = F.edit;
    if (!e) return;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Na pewno usunąć?'; return; }
    hideSheet(); setEditMode(null);
    if (e.pending) { writeOutbox(readOutbox().filter(x => 'q:' + x.cid !== e.id)); rerender(); toast('Wpis usunięty, zanim trafił do arkusza.'); return; }
    undo(e.id);
  });
  document.addEventListener('click', ev => { const r = ev.target.closest('[data-entry]'); if (r) openEntry(r.dataset.entry); });

  /* ================= szczegóły miesiąca (po kliknięciu w wykres) ================= */
  function openDetail(i) {
    const ym = D.yearMonths[i];
    const status = ym.status === 'actual' ? 'rzeczywiste dane' : ym.status === 'current' ? 'w trakcie' : 'prognoza';
    $('detailTitle').innerHTML = `${esc(D.monthNames[i])} ${D.year}<span class="status-chip">${status}</span>`;
    const real = ym.status !== 'future';                 // dla bieżącego: kwoty do dziś
    const rows = D.blocks.map(b => {
      const v = real ? b.perMonth[i] : ((ym.byBlock || {})[b.id] || 0);
      const typical = b.baseline;
      let subs = real ? b.cols.map(c => ({ n: c.name, v: c.perMonth[i] })).filter(x => x.v !== 0).sort((a, c) => c.v - a.v) : [];
      if (subs.length === 1 && Math.abs(subs[0].v - v) < 0.01) subs = [];   // blok z jedną kolumną: bez powtórzenia
      return { b, v, typical, subs };
    }).filter(r => r.v !== 0).sort((a, c) => c.v - a.v);
    const max = Math.max(1, ...rows.map(r => r.v));
    let h = '';
    if (ym.status === 'current') h += `<p class="dnote">Miesiąc trwa: kwoty kategorii to wydatki wpisane do dziś. Suma na koniec miesiąca to prognoza.</p>`;
    if (ym.status === 'future') h += `<p class="dnote">To prognoza: typowy miesiąc z ostatnich danych, raty i terminy przypadające w tym miesiącu.</p>`;
    if (ym.crossA || ym.crossB) h += `<p class="dnote" style="color:var(--warning)">W tym miesiącu dochód przekracza 120 000 zł i część pensji jest opodatkowana stawką 32%.</p>`;
    const spent = real ? ym.actualExpenses : ym.expenses;
    h += `<div class="dsum">
      <div><span>Dochód</span><b class="num">${zlR(ym.incomeA, ym.incomeB)}</b></div>
      <div><span>${ym.status === 'current' ? 'Wydane do dziś' : 'Wydatki'}</span><b class="num">${zl(spent)}</b></div>
      <div><span>${ym.leftA < 0 ? 'Brakuje' : 'Zostaje'}</span><b class="num" style="color:${ym.leftA < 0 ? 'var(--critical)' : 'var(--text)'}">${ym.leftA < 0 && ym.leftB < 0 ? zlR(-ym.leftA, -ym.leftB) : zlR(ym.leftA, ym.leftB)}</b></div>
    </div>`;
    // pasek struktury jak kolumna z wykresu: segmenty bloków + znacznik dochodu
    const st = monthStack(i, true);
    const segs = st.segs.filter(g => g.v > 0);
    const scale = Math.max(st.total, ym.incomeA, ym.incomeB) * 1.02 || 1;
    if (segs.length) {
      h += `<div class="sbar" role="img" aria-label="Struktura wydatków na tle dochodu">${segs.map(g => `<span style="width:${g.v / scale * 100}%;background:${colorOf(g.id)}" title="${esc(g.name)}: ${zl(g.v)}"></span>`).join('')}<i style="left:${Math.min(99.5, ym.incomeA / scale * 100)}%" title="Dochód"></i></div>
        <div class="sbar-cap"><span>${ym.status === 'current' ? 'wydane do dziś' : 'wydatki'} <b class="num">${zl(st.total)}</b></span><span>pionowa kreska = dochód <b class="num">${zl(ym.incomeA)}</b></span></div>`;
    }
    h += rows.map(r => {
      let cmp = '';
      if (ym.status === 'actual' && r.typical > 0) {
        const d = r.v - r.typical;
        if (Math.abs(d) >= Math.max(50, r.typical * 0.15)) cmp = `<div class="cmp ${d > 0 ? 'up' : 'down'}">${d > 0 ? 'o ' + zl(d) + ' więcej' : 'o ' + zl(-d) + ' mniej'} niż typowo (${zl(r.typical)})</div>`;
        else cmp = `<div class="cmp">typowo ${zl(r.typical)}</div>`;
      }
      return `<div class="dblock"><div class="row"><span><i class="dotc" style="background:${colorOf(r.b.id)}"></i>${esc(r.b.name)}</span><b>${zl(r.v)}</b></div>${cmp}
        <div class="bar"><span style="width:${Math.max(2, r.v / max * 100)}%;background:${colorOf(r.b.id)}"></span></div>
        ${r.subs.length ? `<div class="subs">${r.subs.map(x => `<div><span>${esc(pretty(x.n))}</span><span class="num">${zl(x.v)}</span></div>`).join('')}</div>` : ''}</div>`;
    }).join('') || '<p class="dnote">Brak wydatków w tym miesiącu.</p>';
    if (ym.status !== 'future' && D.limits.length) {
      h += `<div class="dsec">Limity w tym miesiącu</div><div class="dlist">${D.limits.map(l => {
        const v = l.series[i] || 0, st = v > l.limit ? 'over' : v >= l.limit * D.warnPct / 100 ? 'warn' : 'ok';
        return `<div><span><span class="state" style="margin:0"><i style="background:${STATE[st].col}"></i></span> ${esc(l.name)}</span><span class="num">${zl(v)} z ${zl(l.limit)}</span></div>`;
      }).join('')}</div>`;
    }
    const ents = (D.entries || []).filter(e => !e.undone && e.date && +e.date.slice(0, 4) === D.year && +e.date.slice(5, 7) - 1 === i);
    if (ents.length) {
      h += `<div class="dsec">Wpisy z formularza</div><div class="dlist">${ents.map(e => `<div><span>${fmtShort(e.date)}, ${esc(entryLabel(e))}${e.desc ? ', ' + esc(e.desc) : ''}</span><span class="num">${e.kind === 'wpływ' ? '+' : ''}${zlc(e.amount)}</span></div>`).join('')}</div>`;
    }
    $('detailBody').innerHTML = h;
    showSheet($('detail'));
  }

  /* ================= edytor limitu ================= */
  const L = { row: null, originalName: '', blockId: '', cols: [], nameTouched: false, busy: false };
  const normKey = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const blockCats = id => (D.categories || []).filter(c => c.kind === 'expense' && c.blockId === id);
  function limitAutoName() {
    const b = D.blocks.find(x => x.id === L.blockId);
    if (!b) return '';
    if (!L.cols.length) return b.name + ' razem';
    return L.cols.map(k => { const c = blockCats(L.blockId).find(x => x.key.split('::')[1] === k); return c ? labelFor(c.block, c.col) : k; }).join(' + ');
  }
  function limitAvg() {
    const b = D.blocks.find(x => x.id === L.blockId);
    if (!b) return '';
    const done = D.months.filter(m => m.status === 'actual' && m.hasData).map(m => m.m);
    if (!done.length) return '';
    const per = done.map(m => L.cols.length
      ? b.cols.filter(c => L.cols.indexOf(normKey(c.name)) >= 0).reduce((s, c) => s + (c.perMonth[m] || 0), 0)
      : b.perMonth[m]);
    const avg = per.reduce((a, c) => a + c, 0) / per.length;
    return `W tym roku średnio ${zl(avg)} miesięcznie, najwięcej ${zl(Math.max(...per))}.`;
  }
  function renderLimitForm() {
    $('limBlock').innerHTML = '<option value="">Wybierz kategorię…</option>' + D.blocks.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    $('limBlock').value = L.blockId;
    const cats = blockCats(L.blockId);
    $('limCols').innerHTML = L.blockId ? `<button type="button" data-all aria-pressed="${!L.cols.length}">Cały blok</button>` +
      cats.map(c => { const k = c.key.split('::')[1]; return `<button type="button" data-col="${esc(k)}" aria-pressed="${L.cols.indexOf(k) >= 0}">${esc(labelFor(c.block, c.col))}</button>`; }).join('') : '';
    if (!L.nameTouched) $('limName').value = limitAutoName();
    $('limAvg').textContent = limitAvg();
    const amt = parseAmount($('limAmount').value);
    $('limSave').disabled = L.busy || !L.blockId || !$('limName').value.trim() || !(amt > 0);
    $('limSave').textContent = L.busy ? 'Zapisuję…' : (L.row ? 'Zapisz zmiany' : 'Dodaj limit');
  }
  function openLimit(row) {
    const def = row ? (D.limitDefs || []).find(l => l.row === row) : null;
    L.row = def ? def.row : null; L.originalName = def ? def.name : '';
    L.blockId = def ? (def.blockId || '') : ''; L.cols = def && def.cols ? def.cols.slice() : [];
    L.nameTouched = !!def; L.busy = false;
    $('limitTitle').textContent = def ? 'Edytuj limit' : 'Nowy limit';
    $('limName').value = def ? def.name : '';
    $('limAmount').value = def ? String(def.limit).replace('.', ',') : '';
    $('limActive').checked = def ? def.active : true;
    $('limActiveRow').hidden = !def;
    $('limDelete').hidden = !def; delete $('limDelete').dataset.armed; $('limDelete').textContent = 'Usuń limit';
    $('limErr').textContent = '';
    renderLimitForm();
    showSheet($('limitSheet'));
  }
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-limit-new]'); if (n) { openLimit(null); return; }
    const ed = e.target.closest('[data-limit-edit]'); if (ed) openLimit(+ed.dataset.limitEdit);
  });
  $('limBlock').addEventListener('change', () => { L.blockId = $('limBlock').value; L.cols = []; renderLimitForm(); });
  $('limCols').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-all')) L.cols = [];
    else { const k = b.dataset.col; L.cols = L.cols.indexOf(k) >= 0 ? L.cols.filter(x => x !== k) : L.cols.concat(k); }
    renderLimitForm();
  });
  $('limName').addEventListener('input', () => { L.nameTouched = true; renderLimitForm(); });
  $('limAmount').addEventListener('input', renderLimitForm);
  $('limSave').addEventListener('click', async () => {
    L.busy = true; $('limErr').textContent = ''; renderLimitForm();
    try {
      const r = await call('saveLimit', { row: L.row, originalName: L.originalName, name: $('limName').value, blockId: L.blockId, cols: L.cols, limit: parseAmount($('limAmount').value), active: $('limActive').checked });
      if (!r.ok) { $('limErr').textContent = r.error; return; }
      applyModel(r.model); hideSheet();
      toast(L.row ? 'Zapisano zmiany limitu.' : 'Dodano limit „' + esc(r.limit.name) + '”.');
    } catch (err) { $('limErr').textContent = 'Nie udało się zapisać: ' + (err.message || err); }
    finally { L.busy = false; renderLimitForm(); }
  });
  $('limDelete').addEventListener('click', async () => {
    const b = $('limDelete');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Na pewno usunąć?'; return; }
    b.disabled = true;
    try {
      const r = await call('deleteLimit', { row: L.row, name: L.originalName });
      if (!r.ok) { $('limErr').textContent = r.error; return; }
      applyModel(r.model); hideSheet(); toast('Usunięto limit „' + esc(L.originalName) + '”.');
    } catch (err) { $('limErr').textContent = 'Nie udało się usunąć: ' + (err.message || err); }
    finally { b.disabled = false; }
  });

  /* ================= wykres „Ile odłożysz” (narastająco, dwa warianty) ================= */
  function drawSavings() {
    const box = document.getElementById('savChart');
    if (!box || !box.clientWidth || !D.savings) return;
    const S = D.savings.series, n = S.length - 1;
    if (n < 1) { box.innerHTML = ''; return; }
    const W = box.clientWidth, H = box.clientHeight;
    const pad = { l: 46, r: 16, t: 22, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxV = Math.max(1, ...S.map(x => Math.max(x.cumA, x.cumB)));
    const minV = Math.min(0, ...S.map(x => Math.min(x.cumA, x.cumB)));
    const stepV = maxV > 40000 ? 20000 : maxV > 20000 ? 10000 : 5000;
    const top = Math.ceil(maxV * 1.08 / stepV) * stepV, bot = Math.floor(minV / stepV) * stepV;
    const X = i => pad.l + iw * i / n;
    const Y = v => pad.t + ih - ((v - bot) / (top - bot)) * ih;
    const A = S.map((x, i) => ({ x: X(i), y: Y(x.cumA) })), Bp = S.map((x, i) => ({ x: X(i), y: Y(x.cumB) }));
    const sA = spline(A), sB = spline(Bp);
    let grid = '';
    for (let v = bot; v <= top; v += stepV) grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="var(--grid)"/><text x="${pad.l - 8}" y="${f1(Y(v) + 4)}" text-anchor="end" fill="var(--muted)" font-size="12">${v ? Math.round(v / 1000) + ' tys.' : '0'}</text>`;
    const pts = D.savings.points.map(pt => S.findIndex(x => x.ymi === pt.ymi)).filter(i => i >= 0);
    const marks = pts.map(i => `<line x1="${f1(X(i))}" x2="${f1(X(i))}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--line)" stroke-dasharray="3 4"/>` +
      `<circle cx="${f1(X(i))}" cy="${f1(A[i].y)}" r="4" fill="var(--left)" stroke="var(--surface)" stroke-width="2"/>`).join('');
    const LX = i => Math.min(Math.max(X(i), pad.l + 14), W - pad.r - 14);
    const keepX = new Set(); let lastX = Infinity;
    [0, ...pts].filter((v, k, a) => a.indexOf(v) === k).sort((a, b) => b - a).forEach(i => { if (lastX - LX(i) >= 54) { keepX.add(i); lastX = LX(i); } });
    const xl = S.map((x, i) => keepX.has(i) ? `<text x="${f1(Math.min(Math.max(X(i), pad.l + 14), W - pad.r - 14))}" y="${H - 6}" text-anchor="middle" fill="var(--muted)" font-size="12">${x.label.replace(' 20', " '")}</text>` : '').join('');
    const ev = S.map((x, i) => x.items.filter(t => /OC\/AC|próg|Przegląd/.test(t)).length ? `<circle cx="${f1(X(i))}" cy="${pad.t - 8}" r="3.5" fill="var(--warning)"><title>${esc(x.label + ': ' + x.items.join(', '))}</title></circle>` : '').join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Narastający przyrost oszczędności do końca ${D.year + 1}">
      ${grid}
      <path d="M${f1(Bp[0].x)},${f1(Bp[0].y)}${fwd(sB, 0, n)}L${f1(A[n].x)},${f1(A[n].y)}${backRange(sA, 0, n)}Z" fill="var(--left)" opacity=".16"/>
      <path d="${lineTo(Bp, sB, 0, n)}" fill="none" stroke="var(--left)" stroke-width="1.6" stroke-dasharray="3 5" opacity=".8"/>
      <path d="${lineTo(A, sA, 0, n)}" fill="none" stroke="var(--left)" stroke-width="2.4"/>
      ${marks}${xl}${ev}
      <g id="savHv" style="display:none" pointer-events="none">
        <line id="savHvL" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--text-2)" stroke-opacity=".5"/>
        <circle id="savHvB" r="4" fill="var(--surface)" stroke="var(--left)" stroke-width="2"/>
        <circle id="savHvA" r="5" fill="var(--left)" stroke="var(--surface)" stroke-width="2"/>
      </g>
      <rect id="savHit" x="${pad.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" style="cursor:crosshair"/>
    </svg><div class="tip" id="savTip" role="status"></div>`;

    /* chmurka: najechanie myszą, dotknięcie albo przesunięcie palcem */
    const hit = box.querySelector('#savHit'), hv = box.querySelector('#savHv'), tip = box.querySelector('#savTip');
    const from = '1.' + String(S[0].ymi % 12 + 1).padStart(2, '0');
    const sign = (a, b) => (Math.min(a, b) >= 0 ? '+' : '') + zlR(a, b);
    const at = cx => Math.max(0, Math.min(n, Math.round((cx - box.getBoundingClientRect().left - pad.l) / (iw / n))));
    let pinned = null;
    const show = i => {
      const x = S[i];
      hv.style.display = '';
      box.querySelector('#savHvL').setAttribute('x1', X(i)); box.querySelector('#savHvL').setAttribute('x2', X(i));
      box.querySelector('#savHvA').setAttribute('cx', X(i)); box.querySelector('#savHvA').setAttribute('cy', A[i].y);
      box.querySelector('#savHvB').setAttribute('cx', X(i)); box.querySelector('#savHvB').setAttribute('cy', Bp[i].y);
      const items = (x.items || []).map(t => `<div class="ev">${esc(t)}</div>`).join('');
      tip.innerHTML = `<div class="t">${esc((D.monthNames || [])[x.ymi % 12] ? D.monthNames[x.ymi % 12] + ' ' + Math.floor(x.ymi / 12) : x.label)}${i === 0 ? ' <em>w trakcie</em>' : ''}</div>
        ${x.incomeA !== undefined ? `<div class="r"><span>Dochód</span><span class="num">${zlR(x.incomeA, x.incomeB)}</span></div>
        <div class="r"><span>Wydatki</span><span class="num">${zl(x.expenses)}</span></div>
        <div class="r"><span>W tym miesiącu</span><span class="num">${sign(x.leftA, x.leftB)}</span></div>` : ''}
        <div class="r sum"><span>Razem od ${from}</span><span class="num">${sign(x.cumA, x.cumB)}</span></div>${items}`;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, X(i) + (X(i) > W / 2 ? -tw - 14 : 14))) + 'px';
      tip.classList.add('on');
    };
    const hide = () => { hv.style.display = 'none'; tip.classList.remove('on'); pinned = null; };
    hit.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' || pinned !== null) show(pinned = at(ev.clientX)); });
    hit.addEventListener('pointerdown', ev => { const i = at(ev.clientX); if (ev.pointerType !== 'mouse' && pinned === i) { hide(); return; } show(pinned = i); });
    hit.addEventListener('touchmove', ev => show(pinned = at(ev.touches[0].clientX)), { passive: true });
    hit.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide(); });
    box._hide = hide;
    box._show = ymi => { const i = S.findIndex(x => x.ymi === ymi); if (i >= 0) show(pinned = i); };
    if (!window.__savOutside) {
      window.__savOutside = true;
      document.addEventListener('pointerdown', ev => { const c = document.getElementById('savChart'); if (c && c._hide && !ev.target.closest('#savChart')) c._hide(); });
    }
  }

  document.addEventListener('click', e => {
    const c = e.target.closest('[data-sav]'); const box = document.getElementById('savChart');
    if (c && box && box._show) { box._show(+c.dataset.sav); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  });

  /* ================= legenda: pokaż tylko jeden blok ================= */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-iso]');
    if (!b) return;
    ISO = b.dataset.iso && b.dataset.iso !== ISO ? b.dataset.iso : null;
    animated = true; const y = window.scrollY; render(); window.scrollTo(0, y);
  });

  /* ================= zapłata płatności cyklicznej ================= */
  function setPayMode(p) {
    F.payment = p || null;
    $('payCtx').hidden = !p;
    $('kindSeg').hidden = !!p;
    $('expensePick').hidden = !!p || F.kind !== 'expense';
    $('incomePick').hidden = !!p || F.kind !== 'income';
    $('unpaid').closest('.check').hidden = !!p || F.kind === 'income';
  }
  function openPay(row) {
    const p = (D.payments || []).find(x => x.row === row);
    if (!p) return;
    setEditMode(null); saveEl.hidden = false;
    F.kind = 'expense'; F.key = p.key; F.other = false;
    buildPickers(); renderRecent();
    setPayMode(p);
    $('sheetTitle').textContent = 'Zapłać: ' + p.name;
    const per = p.periodMonth.toLowerCase() + ' ' + p.periodYear;
    $('payCtx').innerHTML = `Płatność za <b>${esc(per)}</b>${p.invoiceDate ? `, faktura ${fmtDay(p.invoiceDate)}` : ''}, termin <b>${fmtDay(p.dueDate)}</b>. Kwota trafi do: ${esc(p.block)}, ${esc(pretty(p.col))}.` +
      (p.credit > 0 ? `<br>Masz nadpłatę <b class="num">${zlc(p.credit)}</b>. Wpisz kwotę z faktury: do arkusza trafi tylko to, co przelewasz, a reszta nadpłaty zostanie na kolejny rachunek.` : '');
    amountEl.value = p.estimate !== null ? String(p.credit > 0 ? p.estimate : p.toPay).replace('.', ',') : '';
    descEl.value = p.name;
    unpaidEl.checked = false;
    setDate(iso(new Date()));
    dateEl.max = iso(new Date());
    errEl.textContent = '';
    showSheet(sheet);
    update();
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-pay]'); if (b) openPay(+b.dataset.pay); });

  /* ================= edytor płatności ================= */
  const PE = { row: null, originalName: '', every: 1, busy: false };
  const EVERY = [[1, 'co miesiąc'], [2, 'co 2 mies.'], [3, 'co kwartał'], [6, 'co pół roku'], [12, 'co rok']];
  function payCols() {
    const id = $('payBlock').value;
    const cats = (D.categories || []).filter(c => c.kind === 'expense' && c.blockId === id);
    const cur = $('payCol').value;
    $('payCol').innerHTML = '<option value="">Wybierz…</option>' + cats.map(c => `<option value="${esc(c.key.split('::')[1])}">${esc(pretty(c.col))}</option>`).join('');
    if (cats.some(c => c.key.split('::')[1] === cur)) $('payCol').value = cur;
  }
  function renderPayForm() {
    $('payEvery').innerHTML = EVERY.map(([v, t]) => `<button type="button" data-every="${v}" aria-pressed="${PE.every === v}">${t}</button>`).join('');
    $('payFromRow').hidden = PE.every === 1;
    const ok = $('payName').value.trim() && $('payBlock').value && $('payCol').value && +$('payDay').value >= 1 && +$('payDay').value <= 31 && (PE.every === 1 || $('payFrom').value);
    const dd = +$('payDay').value, inv = +$('payInvoice').value;
    $('payInvoiceHint').textContent = inv >= 1 && inv <= 31 && dd >= 1
      ? (inv > dd ? `Faktura ${inv}. dnia miesiąca, termin ${dd}. następnego. Kwotę wpiszę do miesiąca faktury.` : `Faktura ${inv}., termin ${dd}. tego samego miesiąca.`)
      : 'Jeśli rachunek przychodzi w jednym miesiącu, a termin jest w następnym, wpisz dzień faktury.';
    $('paySave').disabled = PE.busy || !ok;
    $('paySave').textContent = PE.busy ? 'Zapisuję…' : (PE.row ? 'Zapisz zmiany' : 'Dodaj płatność');
  }
  function openPayEdit(row) {
    const p = row ? (D.payments || []).find(x => x.row === row) : null;
    PE.row = p ? p.row : null; PE.originalName = p ? p.name : ''; PE.every = p ? p.every : 1; PE.busy = false;
    $('payTitle').textContent = p ? 'Edytuj płatność' : 'Nowa płatność';
    $('payBlock').innerHTML = '<option value="">Wybierz…</option>' + D.blocks.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    $('payBlock').value = p ? p.blockId : '';
    payCols();
    $('payCol').value = p ? p.key.split('::')[1] : '';
    $('payName').value = p ? p.name : '';
    $('payDay').value = p ? p.day : '';
    $('payAmount').value = p && p.amount !== null ? String(p.amount).replace('.', ',') : '';
    $('payCredit').value = p && p.credit ? String(p.credit).replace('.', ',') : '';
    $('payInvoice').value = p && p.invoiceDay ? p.invoiceDay : '';
    $('payFrom').value = p && p.fromYm ? p.fromYm : '';
    $('payDelete').hidden = !p; delete $('payDelete').dataset.armed; $('payDelete').textContent = 'Usuń płatność';
    $('payErr').textContent = '';
    renderPayForm();
    showSheet($('paySheet'));
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-pay-new]')) { openPayEdit(null); return; }
    const ed = e.target.closest('[data-pay-edit]'); if (ed) openPayEdit(+ed.dataset.payEdit);
  });
  $('payBlock').addEventListener('change', () => { $('payCol').value = ''; payCols(); renderPayForm(); });
  $('payCol').addEventListener('change', () => {
    if (!$('payName').value.trim() && $('payCol').value) {
      const c = (D.categories || []).find(k => k.key === $('payBlock').value + '::' + $('payCol').value);
      if (c) $('payName').value = labelFor(c.block, c.col);
    }
    renderPayForm();
  });
  ['payName', 'payDay', 'payFrom', 'payAmount', 'payCredit', 'payInvoice'].forEach(id => $(id).addEventListener('input', renderPayForm));
  $('payEvery').addEventListener('click', e => { const b = e.target.closest('[data-every]'); if (b) { PE.every = +b.dataset.every; renderPayForm(); } });
  $('paySave').addEventListener('click', async () => {
    PE.busy = true; $('payErr').textContent = ''; renderPayForm();
    const amt = $('payAmount').value.trim(), cr = $('payCredit').value.trim();
    try {
      const r = await call('savePayment', { row: PE.row, originalName: PE.originalName, name: $('payName').value, blockId: $('payBlock').value, col: $('payCol').value,
        day: +$('payDay').value, every: PE.every, from: $('payFrom').value, amount: amt ? parseAmount(amt) : '', credit: cr ? parseAmount(cr) : '',
        invoiceDay: $('payInvoice').value.trim() ? +$('payInvoice').value : '' });
      if (!r.ok) { $('payErr').textContent = r.error; return; }
      applyModel(r.model); hideSheet();
      toast(PE.row ? 'Zapisano zmiany płatności.' : 'Dodano płatność „' + esc(r.payment.name) + '”.');
    } catch (err) { $('payErr').textContent = 'Nie udało się zapisać: ' + (err.message || err); }
    finally { PE.busy = false; renderPayForm(); }
  });
  $('payDelete').addEventListener('click', async () => {
    const b = $('payDelete');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Na pewno usunąć?'; return; }
    b.disabled = true;
    try {
      const r = await call('deletePayment', { row: PE.row, name: PE.originalName });
      if (!r.ok) { $('payErr').textContent = r.error; return; }
      applyModel(r.model); hideSheet(); toast('Usunięto płatność „' + esc(PE.originalName) + '”.');
    } catch (err) { $('payErr').textContent = 'Nie udało się usunąć: ' + (err.message || err); }
    finally { b.disabled = false; }
  });

  render();
  renderRecent();
  let rz, wasWide = isWide();
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (isWide() !== wasWide) { wasWide = isWide(); render(); } else drawVisible(); }, 150);
  });
  flushOutbox();
  return { apply: applyModel };
}

/* ================= połączenie z arkuszem (Apps Script jako źródło danych) ================= */
(function () {
  'use strict';
  const CONN = 'finanse.conn';
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  // Połączenie: adres skryptu + przepustka tego urządzenia (token). Starsze połączenia (przed v11) miały klucz główny – zamieniamy je na przepustkę.
  window.getConn = () => { const c = read(CONN); return c && c.url && (c.token || c.key) ? c : null; };
  window.saveConn = c => { try { localStorage.setItem(CONN, JSON.stringify(c.token ? { url: c.url, token: c.token, id: c.id, at: Date.now() } : { url: c.url, key: c.key, at: Date.now() })); } catch (e) { /* bez pamięci przeglądarki */ } };
  // Opis urządzenia do listy „Urządzenia”: system, model (jeśli przeglądarka go poda) i przeglądarka. Bez numerów seryjnych – przeglądarki ich nie udostępniają.
  window.deviceInfo = async () => {
    const ua = navigator.userAgent || '';
    const uad = navigator.userAgentData;
    let os = '', model = '', mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
    if (uad && uad.getHighEntropyValues) {
      try {
        const h = await uad.getHighEntropyValues(['model', 'platformVersion']);
        mobile = !!uad.mobile || mobile;
        const pv = parseInt(String(h.platformVersion || '').split('.')[0], 10);
        if (uad.platform === 'Windows') os = pv >= 13 ? 'Windows 11' : (pv > 0 ? 'Windows 10' : 'Windows');
        else if (uad.platform === 'Android') os = 'Android' + (pv ? ' ' + pv : '');
        else if (uad.platform === 'macOS') os = 'macOS';
        else os = uad.platform || '';
        model = String(h.model || '').trim();
      } catch (e) { /* bez szczegółów */ }
    }
    if (!os) {
      const m = ua.match(/Android (\d+)/); if (m) os = 'Android ' + m[1];
      else if (/iPhone|iPad/.test(ua)) os = /iPad/.test(ua) ? 'iPadOS' : 'iOS';
      else if (/Windows NT 10/.test(ua)) os = 'Windows 10 lub 11';
      else if (/Mac OS X/.test(ua)) os = 'macOS';
      else if (/Linux/.test(ua)) os = 'Linux';
    }
    if (!model) { const m = ua.match(/Android [\d.]+; ([^;)]+)\)/); if (m && m[1] !== 'K') model = m[1].trim(); }
    let browser = navigator.brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'przeglądarka';
    if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) browser += ', zainstalowana';
    const desc = [os, model, browser].filter(Boolean).join(', ');
    const name = mobile ? (/iPad|tablet/i.test(ua) ? 'Tablet' : 'Telefon') : 'Komputer';
    return { desc, name, mobile };
  };
  window.forgetDevice = () => { try { localStorage.removeItem(CONN); localStorage.removeItem('finanse.cache'); localStorage.removeItem('finanse.knownDevices'); } catch (e) { /* bez pamięci */ } };
  // Zapytanie do skryptu: POST jako text/plain (bez zapytania wstępnego CORS), klucz w treści, nie w adresie.
  window.api = (fn, arg, conn) => {
    conn = conn || window.getConn();
    if (!conn || !conn.url) return Promise.reject(Object.assign(new Error('To urządzenie nie jest połączone z arkuszem.'), { auth: true }));
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 45000);
    return fetch(conn.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign(conn.token ? { token: conn.token } : { key: conn.key || '' }, { fn, arg: arg === undefined ? null : arg })), signal: ctrl ? ctrl.signal : undefined, cache: 'no-store', redirect: 'follow' })
      .then(r => { if (!r.ok) throw new Error('Skrypt odpowiedział błędem ' + r.status + '.'); return r.text(); })
      .then(t => {
        let j;
        try { j = JSON.parse(t); } catch (e) { throw new Error(/<html/i.test(t) ? 'Skrypt nie działa jeszcze jako źródło danych. Sprawdź, czy wdrożenie ma dostęp „Każdy” i nową wersję kodu.' : 'Niepoprawna odpowiedź skryptu.'); }
        if (j && j.ok === false && j.auth) throw Object.assign(new Error(j.error || 'Brak dostępu.'), { auth: true, revoked: !!j.revoked });
        return j;
      }, e => {
        if (e && e.name === 'AbortError') throw new Error('Arkusz nie odpowiedział w ciągu 45 sekund. Spróbuj ponownie.');
        if (e instanceof TypeError) throw new Error('Nie udało się połączyć ze skryptem. Sprawdź internet albo adres skryptu.');
        throw e;
      })
      .finally(() => clearTimeout(timer));
  };
})();

/* ================= start: najpierw ostatnie dane z pamięci przeglądarki, potem świeże z arkusza ================= */
(function () {
  'use strict';
  const KEY = 'finanse.cache';
  const syncEl = document.getElementById('sync');
  const appEl = document.getElementById('app');
  let app = null, mismatch = '';
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function readCache() {
    try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.version === CLIENT_VERSION && c.model ? c : null; } catch (e) { return null; }
  }
  window.saveCache = m => { try { localStorage.setItem(KEY, JSON.stringify({ version: CLIENT_VERSION, savedAt: Date.now(), model: m })); } catch (e) { /* bez pamięci przeglądarki */ } };
  function status(kind, html) {
    // zwykłe odświeżanie: tylko kręcąca się ikona w pasku aplikacji; komunikat tylko przy błędzie albo niezgodnych wersjach
    document.body.classList.toggle('syncing', kind === 'busy');
    if (kind === 'busy' || kind === 'ok') kind = '';
    if (!kind && !mismatch) { syncEl.hidden = true; syncEl.innerHTML = ''; return; }
    syncEl.hidden = false;
    syncEl.className = 'sync ' + (kind || 'warn');
    syncEl.innerHTML = (kind ? `<span>${html}</span>` : '') + (mismatch ? `<span class="mm">${mismatch}</span>` : '');
  }
  function checkVersion(sv) {
    mismatch = !sv || sv === CLIENT_VERSION ? '' : `Strona jest w wersji v${CLIENT_VERSION}, a skrypt w Apps Script v${escHtml(sv)}. Wklej nowy Code.gs i wdróż nową wersję.`;
  }
  function start(model) {
    document.body.classList.remove('booting', 'setup');
    app = startApp(model);
  }
  // Znane urządzenia: przy pierwszym połączeniu wszystkie obecne uznajemy za swoje; każde następne nowe wywoła pytanie „To Twoje?”.
  window.markKnownDevices = (m, ids) => {
    try {
      const cur = JSON.parse(localStorage.getItem('finanse.knownDevices') || 'null');
      const all = ids || (m && m.devices ? m.devices.list.map(d => d.id) : []);
      localStorage.setItem('finanse.knownDevices', JSON.stringify(Array.from(new Set((cur || []).concat(all)))));
    } catch (e) { /* bez pamięci */ }
  };
  async function migrate() {
    // połączenie sprzed v11 (klucz główny w przeglądarce) → własna przepustka urządzenia, klucz znika z urządzenia
    const c = window.getConn();
    if (!c || c.token || !c.key) return;
    try {
      const info = await window.deviceInfo();
      const r = await window.api('register', { name: info.name + (info.desc ? ' (' + info.desc.split(', ')[0] + ')' : ''), desc: info.desc }, c);
      if (r && r.ok && r.token) window.saveConn({ url: c.url, token: r.token, id: r.id });
    } catch (e) { /* skrypt sprzed v11 albo brak sieci – spróbujemy przy następnym otwarciu */ }
  }
  async function refresh() {
    if (!window.getConn()) return;
    status('busy', '');
    await migrate();
    window.api('refreshData').then(m => {
      if (!m || m.ok === false) throw new Error(m && m.error || 'Skrypt nie zwrócił danych.');
      checkVersion(m.version);
      try { if (m.devices && localStorage.getItem('finanse.knownDevices') === null) window.markKnownDevices(m); } catch (e) { /* bez pamięci */ }
      window.saveCache(m);
      if (app) app.apply(m); else start(m);
      status('', '');
    }).catch(e => {
      if (e.auth) {
        status('err', escHtml(e.message) + ' <button type="button" data-relink>Połącz ponownie</button>');
        return;
      }
      status('err', (app ? 'Nie udało się odświeżyć, pokazuję zapisane dane. ' : 'Nie udało się wczytać danych. ') + escHtml(e.message || e) + ' <button type="button" data-retry>Spróbuj ponownie</button>');
    });
  }

  /* --- ekran pierwszego połączenia --- */
  function showSetup(message) {
    document.body.classList.remove('booting');
    document.body.classList.add('setup');
    document.getElementById('abSub').textContent = 'połączenie z arkuszem';
    status('', '');
    const needUrl = !SCRIPT_URL;
    appEl.innerHTML = `<section class="setup" aria-labelledby="h-setup">
      <img class="setup-ico" src="icons/icon-192.png" alt="" width="64" height="64">
      <h1 id="h-setup">Połącz to urządzenie</h1>
      <p class="setup-lead">Robisz to tylko raz. Potem aplikacja otwiera się od razu, a dane biorą się z Twojego arkusza.</p>
      <div class="setup-choices" id="suChoices">
        <button type="button" class="choice" data-mode="key"><b>Pierwsze urządzenie</b><span>Mam klucz utworzony w Apps Script</span><i aria-hidden="true">›</i></button>
        <button type="button" class="choice" data-mode="code"><b>Kolejne urządzenie</b><span>Mam 6-cyfrowy kod z urządzenia, na którym aplikacja już działa</span><i aria-hidden="true">›</i></button>
      </div>
      <form id="setupForm" novalidate hidden>
        <button type="button" class="linkish su-back" id="suBack">‹ Zmień sposób połączenia</button>
        ${needUrl ? `<label class="field"><span>Adres skryptu (kończy się na /exec)</span><input id="suUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>` : ''}
        <label class="field" id="suCodeRow" hidden><span>Kod parowania (6 cyfr)</span><input id="suCode" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000"></label>
        <p class="hint-avg" id="suCodeHint" hidden>Na urządzeniu, które już działa: Plan → To urządzenie → Połącz nowe urządzenie. Kod jest ważny 5 minut.</p>
        <label class="field" id="suKeyRow" hidden><span>Klucz</span><input id="suKey" autocomplete="off" spellcheck="false" placeholder="48 znaków z Apps Script"></label>
        <p class="hint-avg" id="suKeyHint" hidden>Klucz tworzysz w Apps Script: Uruchom → utworzKlucz, a potem skopiuj go z dziennika wykonania.</p>
        <label class="field"><span>Nazwa tego urządzenia</span><input id="suName" maxlength="40" autocomplete="off" placeholder="np. Telefon Maćka"></label>
        <p class="hint-avg">Pod tą nazwą zobaczysz je na liście urządzeń. Możesz ją później zmienić.</p>
        <p class="err" id="suErr" role="alert">${message ? escHtml(message) : ''}</p>
        <button class="save" id="suGo" type="submit">Połącz</button>
      </form>
      <p class="setup-foot">Klucz zostaje tylko na tym urządzeniu. Bez niego skrypt nie pokaże nikomu Twoich danych.</p>
    </section>`;
    let mode = 'key';
    const $s = id => document.getElementById(id);
    appEl.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $s('suChoices').hidden = true; $s('setupForm').hidden = false;
      $s('suCodeRow').hidden = $s('suCodeHint').hidden = mode !== 'code';
      $s('suKeyRow').hidden = $s('suKeyHint').hidden = mode !== 'key';
      $s('suErr').textContent = '';
      (mode === 'code' ? $s('suCode') : $s('suKey')).focus();
    }));
    window.deviceInfo().then(i => { const n = $s('suName'); if (n && !n.value) n.value = i.name + (i.desc ? ' (' + i.desc.split(', ')[0] + ')' : ''); });
    $s('suBack').addEventListener('click', () => { $s('setupForm').hidden = true; $s('suChoices').hidden = false; $s('suErr').textContent = ''; });
    if (message) { $s('suChoices').hidden = true; $s('setupForm').hidden = false; $s('suKeyRow').hidden = $s('suKeyHint').hidden = false; }
    $s('suCode').addEventListener('input', e => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d; });
    $s('setupForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = $s('suErr'), go = $s('suGo');
      const url = (SCRIPT_URL || ($s('suUrl') ? $s('suUrl').value : '')).trim();
      err.textContent = '';
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { err.textContent = 'Wklej pełny adres wdrożenia z Apps Script. Kończy się na /exec.'; return; }
      go.disabled = true; go.textContent = 'Łączę…';
      try {
        const info = await window.deviceInfo();
        const name = ($s('suName').value || info.name).trim();
        let conn;
        if (mode === 'code') {
          const code = $s('suCode').value.replace(/\D/g, '');
          if (code.length !== 6) throw new Error('Wpisz 6 cyfr kodu.');
          const r = await window.api('pairFinish', { code, name, desc: info.desc }, { url, key: '' });
          if (!r || !r.ok) throw new Error(r && r.error || 'Nie udało się sparować.');
          conn = r.token ? { url, token: r.token, id: r.id } : { url, key: r.key };   // r.key: skrypt sprzed v11
        } else {
          const key = $s('suKey').value.trim();
          if (key.length < 20) throw new Error('Wklej cały klucz z Apps Script.');
          const r = await window.api('register', { name, desc: info.desc }, { url, key });
          if (r && r.ok && r.token) conn = { url, token: r.token, id: r.id };
          else if (r && /Nieznana operacja/.test(r.error || '')) conn = { url, key };   // skrypt sprzed v11: zostajemy przy kluczu
          else throw new Error(r && r.error || 'Nie udało się połączyć.');
        }
        const m = await window.api('refreshData', null, conn);
        if (!m || m.ok === false || !m.year) throw new Error(m && m.error || 'Skrypt nie zwrócił danych.');
        window.saveConn(conn);
        window.markKnownDevices(m);
        window.saveCache(m);
        checkVersion(m.version);
        start(m);
        status('', '');
      } catch (e) {
        err.textContent = e.message || String(e);
      } finally {
        if (go.isConnected) { go.disabled = false; go.textContent = 'Połącz'; }
      }
    });
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-retry]') || e.target.closest('[data-refresh]')) refresh();
    if (e.target.closest('[data-relink]')) { window.forgetDevice(); location.reload(); }
  });
  // dane mogą zmienić się w arkuszu, gdy aplikacja leży w tle – odśwież po powrocie (nie częściej niż co minutę)
  let lastFocus = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app && Date.now() - lastFocus > 60000) refresh();
    if (document.visibilityState === 'hidden') lastFocus = Date.now();
  });

  if (!window.getConn()) { showSetup(''); }
  else {
    const cached = readCache();
    if (cached) start(cached.model);
    refresh();
  }

  // instalacja jako aplikacja (działa tylko na https)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* bez trybu offline */ });
  }
})();
