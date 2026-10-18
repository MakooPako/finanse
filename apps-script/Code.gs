/****************************************************************
 * DASHBOARD FINANSÓW – Google Apps Script (projekt w arkuszu)
 *
 * Od wersji 10 skrypt jest tylko źródłem danych (API). Strona aplikacji
 * leży na GitHub Pages (makoopako.github.io/finanse) i łączy się z tym skryptem przez doPost.
 *  - Wdrożenie: Aplikacja internetowa, Wykonaj jako: Ja, Kto ma dostęp: Każdy.
 *    Przy zmianach edytuj istniejące wdrożenie (Nowa wersja), żeby adres się nie zmienił.
 *  - Klucz główny: funkcja utworzKlucz (wynik w dzienniku wykonania). Służy do połączenia pierwszego urządzenia.
 *  - Każde urządzenie ma własną przepustkę; lista w zakładce „Urządzenia” i w aplikacji (Plan → Urządzenia).
 *  - Bez przepustki albo klucza skrypt nie zwraca żadnych danych.
 * Alerty są tylko na dashboardzie – skrypt nie wysyła maili
 * i nie potrzebuje żadnych wyzwalaczy.
 * Do diagnostyki możesz ręcznie uruchomić debugModel (wynik w dzienniku).
 *
 * Skrypt zapisuje do arkusza tylko przez formularz „Dodaj wpis”:
 *  - dopisuje kwotę do komórki miesiąca jako =stara+nowa,
 *  - zapisuje każdy wpis w zakładce „Wpisy” (dziennik, z możliwością cofnięcia).
 ****************************************************************/

const CFG = {
  VERSION: '11',            // ta sama liczba jest w Index.html (CLIENT_VERSION); strona ostrzega, gdy się różnią
  SETTINGS_SHEET: 'Ustawienia',
  DEADLINES_SHEET: 'Terminy',
  LOG_SHEET: 'Wpisy',
  DEVICES_SHEET: 'Urządzenia',
  LOG_HEADER: ['ID', 'Dodano', 'Data zakupu', 'Typ', 'Kategoria', 'Kwota', 'Opis',
    'Niezapłacone', 'Komórka', 'Było', 'Jest', 'Status', 'Z nadpłaty', 'Płatność'],
  LOG_SHOW: 40,
  DEFAULT_PATTERN: 'Mako - opłaty miesięczne {ROK}',
  MONTHS: ['STYCZEŃ', 'LUTY', 'MARZEC', 'KWIECIEŃ', 'MAJ', 'CZERWIEC', 'LIPIEC',
    'SIERPIEŃ', 'WRZESIEŃ', 'PAŹDZIERNIK', 'LISTOPAD', 'GRUDZIEŃ'],
  MONTH_SHORT: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  MONTH_NAME: ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec',
    'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'],
  // Bloki rozpoznawane po tytule nad nagłówkiem "MIESIĄC".
  // Kolejność ma znaczenie: dłuższe prefiksy przed krótszymi.
  // id: null = blok ignorowany (historia / nieaktualne tabele).
  BLOCKS: [
    { prefix: 'MIESZKANIE TBS', id: 'tbs', name: 'Mieszkanie TBS', expense: true },
    { prefix: 'MIESZKANIE', id: 'mieszkanie', name: 'Mieszkanie', expense: true },
    { prefix: 'SAMOCHÓD', id: 'auto', name: 'Samochód', expense: true, excludeFromBaseline: ['OC/AC PRZEGLĄD'] },
    { prefix: 'WAŻNE WYDATKI', id: 'wazne', name: 'Ważne', expense: true },
    { prefix: 'NIEISTOTNE WYDATKI', id: 'nieistotne', name: 'Nieistotne', expense: true },
    { prefix: 'KREDYT AGD', id: null },
    { prefix: 'KREDYT', id: 'kredyt', name: 'Kredyt i raty', expense: true, baseline: 'commitments' },
    { prefix: 'WAKACJE', id: 'wakacje', name: 'Wakacje', expense: true, baseline: 'zero' },
    { prefix: 'SERWISY STREAMINGOWE', id: 'streaming', name: 'Abonamenty', expense: false },
    { prefix: 'POZOSTAŁO NETTO', id: 'netto', name: 'Pozostało netto', expense: false },
    { prefix: 'WYDATKI OLA', id: null }
  ],
  IGNORED_TEXT: ['BRAK', '-', '—', 'X'],
  UNPAID_NOTE: /niezapła|nie zapła|do zapłaty/i
};

/* ============================ API DLA STRONY ============================ */
/*
 * Strona wysyła POST z treścią {"token" albo "key", "fn": "...", "arg": {...}} jako text/plain
 * (bez zapytania wstępnego CORS). Odpowiedź to JSON. Bez ważnej przepustki albo klucza nie ma żadnych danych.
 * Celowo nie ma tu HtmlService: strona HTML z Apps Script pozwalałaby wołać funkcje przez google.script.run z pominięciem zabezpieczeń.
 *
 * Przepustki urządzeń (od v11):
 *  - główny klucz (utworzKlucz) służy tylko do połączenia pierwszego urządzenia i awaryjnie,
 *  - każde połączone urządzenie dostaje własną przepustkę; w zakładce „Urządzenia” zapisany jest tylko jej skrót (SHA-256),
 *  - usunięcie urządzenia od razu je odcina, inne działają dalej.
 */

function doGet() {
  return ContentService.createTextOutput('Finanse: to jest adres danych aplikacji. Bez przepustki urządzenia nie ma tu żadnych danych.');
}

function doPost(e) {
  let req = null;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : ''); } catch (err) { req = null; }
  if (!req || typeof req !== 'object') return apiJson_({ ok: false, error: 'Niepoprawne zapytanie.' });
  try {
    if (req.fn === 'pairFinish') return apiJson_(pairFinish_(req.arg));   // jedyna operacja bez przepustki: kod parowania → nowa przepustka
    const who = authorize_(req);
    if (!who.ok) return apiJson_({ ok: false, auth: true, revoked: !!who.revoked, error: who.error });
    const actions = {
      refreshData: refreshData, addEntry: addEntry, undoEntry: undoEntry,
      saveLimit: saveLimit, deleteLimit: deleteLimit, savePayment: savePayment, deletePayment: deletePayment,
      pairStart: pairStart_,
      register: function (arg) { return JSON.stringify(registerDevice_(arg, who.device ? 'kod' : 'klucz')); },
      renameDevice: function (arg) { return withDevices_(who, renameDevice_(arg)); },
      removeDevice: function (arg) { return withDevices_(who, removeDevice_(arg, who)); }
    };
    if (!Object.prototype.hasOwnProperty.call(actions, req.fn)) return apiJson_({ ok: false, error: 'Nieznana operacja.' });
    if (req.fn === 'register' && who.device) return apiJson_({ ok: false, error: 'To urządzenie jest już połączone.' });
    const out = actions[req.fn](req.arg === undefined ? null : req.arg);
    return apiText_(attachDevices_(out, who));
  } catch (err) {
    return apiJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function apiText_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }
function apiJson_(o) { return apiText_(JSON.stringify(o)); }

/** Dokłada listę urządzeń do modelu (sam model albo { ok, model }), żeby aplikacja zawsze ją miała. */
function attachDevices_(out, who) {
  let o;
  try { o = JSON.parse(out); } catch (e) { return out; }
  const target = o && o.year ? o : (o && o.model && o.model.year ? o.model : null);
  if (!target) return out;
  target.devices = devicesInfo_(who.device ? who.device.id : null);
  return JSON.stringify(o);
}

function withDevices_(who, res) {
  res.devices = devicesInfo_(who.device ? who.device.id : null);
  return JSON.stringify(res);
}

/** Kto pyta: urządzenie z przepustką albo ktoś z głównym kluczem (pierwsze połączenie, stare urządzenia przed v11). */
function authorize_(req) {
  if (typeof req.token === 'string' && req.token) {
    const dev = deviceByToken_(req.token);
    if (dev && dev.active) { touchDevice_(dev); return { ok: true, device: dev }; }
    if (dev) {
      const c = CacheService.getScriptCache();
      if (!c.get('rv_' + dev.id)) { c.put('rv_' + dev.id, '1', 3600); logEvent_('blocked', dev.name, 'próba użycia usuniętego urządzenia'); }
      return { ok: false, revoked: true, error: 'To urządzenie zostało odłączone. Połącz je ponownie kluczem albo kodem z innego urządzenia.' };
    }
    return { ok: false, revoked: true, error: 'Nie rozpoznaję tego urządzenia. Połącz je ponownie kluczem albo kodem.' };
  }
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real) return { ok: false, error: 'Skrypt nie ma jeszcze klucza. Uruchom w edytorze Apps Script funkcję utworzKlucz.' };
  // Klucz ma ok. 180 bitów losowości, więc nie trzeba blokady (pozwalałaby obcemu odciąć właściciela złymi kluczami).
  if (typeof req.key !== 'string' || !sameText_(req.key.trim(), real)) return { ok: false, error: 'Niepoprawny klucz.' };
  return { ok: true, device: null };
}

/** Porównanie bez skracania przy pierwszej różnicy (czas nie zdradza, ile znaków się zgadza). */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------------- urządzenia ---------------- */

const DEV_HEADER = ['ID', 'Nazwa', 'Urządzenie', 'Połączono', 'Ostatnio', 'Sposób', 'Status', 'Usunięto', 'Skrót przepustki'];

function devicesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CFG.DEVICES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.DEVICES_SHEET);
    sh.appendRow(DEV_HEADER);
    try {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, DEV_HEADER.length).setFontWeight('bold');
      sh.getRange('D:E').setNumberFormat('yyyy-mm-dd hh:mm');
      sh.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm');
    } catch (e) { /* formatowanie jest opcjonalne */ }
  }
  return sh;
}

function readDevices_() {
  const sh = devicesSheet_();
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < v.length; r++) {
    if (isEmpty_(v[r][0])) continue;
    out.push({
      row: r + 1, id: String(v[r][0]), name: String(v[r][1] || ''), desc: String(v[r][2] || ''),
      created: isDate_(v[r][3]) ? v[r][3] : null, seen: isDate_(v[r][4]) ? v[r][4] : null,
      method: String(v[r][5] || ''), active: !/usuni/i.test(String(v[r][6] || '')),
      removed: isDate_(v[r][7]) ? v[r][7] : null, hash: String(v[r][8] || '')
    });
  }
  return out;
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function deviceByToken_(token) {
  const hash = sha256_(token);
  return readDevices_().filter(function (d) { return d.hash && sameText_(d.hash, hash); })[0] || null;
}

/** Ostatnia aktywność: zapis najwyżej co 10 minut na urządzenie (żeby nie spowalniać każdego zapytania). */
function touchDevice_(dev) {
  const c = CacheService.getScriptCache();
  if (c.get('seen_' + dev.id)) return;
  c.put('seen_' + dev.id, '1', 600);
  devicesSheet_().getRange(dev.row, 5).setValue(new Date());
}

function cleanText_(s, max) { return String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

function registerDevice_(arg, method) {
  arg = arg || {};
  const name = cleanText_(arg.name, 40) || 'Urządzenie';
  const desc = cleanText_(arg.desc, 80);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 64 znaki szesnastkowe, ok. 240 bitów losowości
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    devicesSheet_().appendRow([id, name, desc, now, now, method, 'aktywne', '', sha256_(token)]);
  } finally { lock.releaseLock(); }
  logEvent_('connect', name, desc + (method === 'kod' ? ', kodem z innego urządzenia' : ', głównym kluczem'));
  return { ok: true, token: token, id: id };
}

function renameDevice_(arg) {
  const name = cleanText_(arg && arg.name, 40);
  if (!name) throw new Error('Podaj nazwę urządzenia.');
  const d = readDevices_().filter(function (x) { return x.id === String(arg.id); })[0];
  if (!d) throw new Error('Nie znalazłem tego urządzenia.');
  devicesSheet_().getRange(d.row, 2).setValue(name);
  logEvent_('rename', name, 'wcześniej: ' + d.name);
  return { ok: true };
}

function removeDevice_(arg, who) {
  const d = readDevices_().filter(function (x) { return x.id === String(arg && arg.id); })[0];
  if (!d) throw new Error('Nie znalazłem tego urządzenia.');
  if (!d.active) return { ok: true };
  const sh = devicesSheet_();
  sh.getRange(d.row, 7, 1, 2).setValues([['usunięte', new Date()]]);
  logEvent_('remove', d.name, who.device && who.device.id === d.id ? 'na nim samym' : (who.device ? 'z urządzenia „' + who.device.name + '”' : 'kluczem głównym'));
  return { ok: true, self: !!(who.device && who.device.id === d.id) };
}

/** Lista dla aplikacji: bez skrótów przepustek. Usunięte urządzenia z ostatnich 90 dni jako historia. */
function devicesInfo_(currentId) {
  const iso = function (d) { return d ? d.toISOString() : null; };
  const limit = Date.now() - 90 * 864e5;
  const list = readDevices_().filter(function (d) { return d.active || (d.removed && d.removed.getTime() > limit); }).map(function (d) {
    return { id: d.id, name: d.name, desc: d.desc, created: iso(d.created), seen: iso(d.seen), method: d.method, active: d.active, removed: iso(d.removed), current: d.id === currentId };
  });
  return { list: list, events: readEvents_().slice(0, 30), current: currentId };
}

/* ---------------- historia zdarzeń (ostatnie 60, w ustawieniach skryptu) ---------------- */

function readEvents_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEV_EVENTS') || '[]'); } catch (e) { return []; }
}

function logEvent_(type, name, info) {
  const props = PropertiesService.getScriptProperties();
  const ev = readEvents_();
  ev.unshift({ t: new Date().toISOString(), type: type, name: cleanText_(name, 40), info: cleanText_(info, 120) });
  props.setProperty('DEV_EVENTS', JSON.stringify(ev.slice(0, 60)));
}

/* ---------------- parowanie kodem ---------------- */

/**
 * Połączone urządzenie prosi o 6-cyfrowy kod ważny 5 minut; nowe urządzenie wymienia go raz na własną przepustkę
 * (główny klucz nigdy nie trafia na nowe urządzenie). Po 10 błędnych kodach parowanie jest wyłączone na 15 minut.
 */
function pairStart_() {
  const cache = CacheService.getScriptCache();
  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000).padStart(6, '0');
  cache.put('pair_' + code, '1', 300);
  return JSON.stringify({ ok: true, code: code, seconds: 300 });
}

function pairFinish_(arg) {
  const cache = CacheService.getScriptCache();
  const bad = Number(cache.get('pair_bad') || 0);
  if (bad >= 10) return { ok: false, error: 'Za dużo błędnych kodów. Parowanie wróci za 15 minut.' };
  const code = String(arg && arg.code || '').replace(/\D/g, '');
  if (code.length !== 6 || !cache.get('pair_' + code)) {
    cache.put('pair_bad', String(bad + 1), 900);
    if (bad + 1 === 3 || bad + 1 === 10) logEvent_('pair_fail', '', (bad + 1) + ' błędne kody parowania w ciągu 15 minut');
    return { ok: false, error: 'Kod jest nieprawidłowy albo wygasł. Poproś o nowy na połączonym urządzeniu.' };
  }
  cache.remove('pair_' + code);   // kod działa tylko raz
  return registerDevice_(arg, 'kod');
}

/* ---------------- funkcje do uruchamiania ręcznie w edytorze ---------------- */

/**
 * Uruchom → utworzKlucz. Nowy główny klucz pojawi się w dzienniku wykonania.
 * Stary klucz przestaje działać. Połączone urządzenia działają dalej (mają własne przepustki);
 * obce usuń w aplikacji (Plan → Urządzenia) albo uruchom odlaczWszystkieUrzadzenia.
 */
function utworzKlucz() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 48);   // 48 znaków szesnastkowych, ok. 180 bitów losowości
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  CacheService.getScriptCache().remove('pair_bad');
  logEvent_('key_new', '', 'utworzono nowy klucz główny');
  Logger.log('Nowy klucz do aplikacji (skopiuj go): ' + key);
  return key;
}

/** Awaryjnie: odłącza wszystkie urządzenia. Potem łączysz je od nowa kluczem i kodami. */
function odlaczWszystkieUrzadzenia() {
  const sh = devicesSheet_();
  const now = new Date();
  readDevices_().filter(function (d) { return d.active; }).forEach(function (d) { sh.getRange(d.row, 7, 1, 2).setValues([['usunięte', now]]); });
  logEvent_('remove', 'wszystkie urządzenia', 'funkcją odlaczWszystkieUrzadzenia');
  Logger.log('Wszystkie urządzenia odłączone.');
}

/** Czyta arkusz i zwraca gotowy model dashboardu. */
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = parseSettings_(readSheetValues_(ss, CFG.SETTINGS_SHEET));
  const year = settings.year || new Date().getFullYear();
  const cur = readYearSheet_(ss, settings.sheetPattern, year);
  if (!cur) throw new Error('Nie znaleziono zakładki „' + sheetName_(settings.sheetPattern, year) + '”. Sprawdź zakładkę Ustawienia.');
  const deadlines = parseDeadlines_(readSheetValues_(ss, CFG.DEADLINES_SHEET));
  const logSheet = ss.getSheetByName(CFG.LOG_SHEET);
  const model = buildModel_({
    entries: logSheet ? parseLog_(logSheet.getDataRange().getValues()) : [],
    year: year,
    today: new Date(),
    cur: cur,
    loadPrev: function () { return readYearSheet_(ss, settings.sheetPattern, year - 1); },
    settings: settings,
    deadlines: deadlines
  });
  model.sheetUrl = ss.getUrl();
  model.version = CFG.VERSION;
  try {
    const tz = Session.getScriptTimeZone();
    if (tz && tz !== 'Europe/Warsaw') model.warnings.push('Strefa czasowa skryptu to ' + tz + '. Ustaw Europe/Warsaw (Apps Script → Ustawienia projektu), żeby terminy liczyły się co do dnia.');
  } catch (e) { /* bez dostępu do ustawień projektu */ }
  return model;
}

function readSheetValues_(ss, name) {
  const sh = ss.getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : null;
}

function readYearSheet_(ss, pattern, year) {
  const sh = ss.getSheetByName(sheetName_(pattern, year));
  if (!sh) return null;
  const rng = sh.getDataRange();
  return parseYearSheet_(rng.getValues(), rng.getNotes());
}

function sheetName_(pattern, year) {
  return String(pattern || CFG.DEFAULT_PATTERN).replace('{ROK}', year);
}

/* ======================= PARSOWANIE ARKUSZA ======================= */

function norm_(v) {
  return String(v === null || v === undefined ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim();
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function isEmpty_(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Liczba z komórki: liczba, "1 234,56", "1234.56 zł". Tekst → null. */
function toNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (isEmpty_(v) || isDate_(v) || typeof v === 'boolean') return null;
  const s = String(v).replace(/[\s\u00a0]/g, '').replace(/zł$/i, '');
  if (/^-?\d+(,\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return null;
}

function findBlockDef_(title) {
  const t = norm_(title);
  if (!t) return null;
  for (let i = 0; i < CFG.BLOCKS.length; i++) {
    if (t.indexOf(CFG.BLOCKS[i].prefix) === 0) return CFG.BLOCKS[i];
  }
  return null;
}

/**
 * Szuka w arkuszu bloków: komórka "MIESIĄC" = nagłówek, komórka nad nią = tytuł,
 * 12 wierszy poniżej = miesiące. Działa niezależnie od położenia bloków.
 */
function parseYearSheet_(values, notes) {
  const blocks = {};
  const warnings = [];
  for (let r = 1; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (norm_(values[r][c]) !== 'MIESIĄC') continue;
      const title = values[r - 1][c];
      const def = findBlockDef_(title);
      if (!def) {
        if (!isEmpty_(title)) warnings.push('Nierozpoznany blok „' + String(title).trim() + '” – pominięty.');
        continue;
      }
      if (!def.id || blocks[def.id]) continue;
      const block = readBlock_(values, notes, r, c, def, String(title).trim(), warnings);
      if (block) blocks[def.id] = block;
    }
  }
  return { blocks: blocks, warnings: warnings };
}

function readBlock_(values, notes, hr, hc, def, title, warnings) {
  const header = values[hr];
  // Czy przed kolejnym "MIESIĄC" jest kolumna "RAZEM"? (wtedy puste nagłówki po drodze to też kolumny)
  let razemAhead = false;
  for (let c = hc + 1; c < header.length; c++) {
    const h = norm_(header[c]);
    if (h === 'MIESIĄC') break;
    if (h === 'RAZEM') { razemAhead = true; break; }
  }
  const cols = [];
  let totalCol = -1;
  for (let c = hc + 1; c < header.length; c++) {
    const h = norm_(header[c]);
    if (h === 'MIESIĄC') break;
    if (h === 'RAZEM') { totalCol = c; break; }
    if (!h && !razemAhead) break;
    cols.push({ c: c, name: String(header[c]).replace(/\s+/g, ' ').trim() || '(bez nazwy)', key: h, unnamed: !h });
  }
  if (!cols.length) return null;

  const months = [];
  for (let m = 0; m < 12; m++) {
    const row = values[hr + 1 + m];
    if (!row || norm_(row[hc]) !== CFG.MONTHS[m]) {
      warnings.push('Blok „' + title + '”: nie znalazłem wiersza ' + CFG.MONTHS[m] + ' – blok pominięty.');
      return null;
    }
    const noteRow = notes && notes[hr + 1 + m] ? notes[hr + 1 + m] : [];
    const vals = [], texts = [], unpaid = [];
    let hasData = false, sum = 0;
    cols.forEach(function (col, i) {
      const raw = row[col.c];
      const n = toNum_(raw);
      vals[i] = n;
      if (!isEmpty_(raw)) hasData = true;
      if (n !== null) sum += n;
      else if (!isEmpty_(raw) && CFG.IGNORED_TEXT.indexOf(norm_(raw)) < 0) texts.push({ col: col.name, text: String(raw).trim() });
      const note = noteRow[col.c];
      if (note && CFG.UNPAID_NOTE.test(note)) unpaid.push({ col: col.name, amount: n, note: String(note).trim() });
    });
    let total = sum;
    if (totalCol >= 0) {
      const t = toNum_(row[totalCol]);
      if (t !== null) total = t;
    }
    months.push({ hasData: hasData, total: hasData ? total : 0, vals: vals, texts: texts, unpaid: unpaid });
  }
  return { id: def.id, name: def.name, title: title, def: def, hr: hr, hc: hc, months: months,
    cols: cols.map(function (x) { return { name: x.name, key: x.key, c: x.c, unnamed: x.unnamed }; }) };
}

function colIndex_(block, key) {
  const k = norm_(key);
  for (let i = 0; i < block.cols.length; i++) if (block.cols[i].key === k) return i;
  return -1;
}

function findBlockByLabel_(B, label) {
  const l = norm_(label);
  if (!l) return null;
  const ids = Object.keys(B);
  for (let i = 0; i < ids.length; i++) {
    const b = B[ids[i]];
    if (norm_(b.title).indexOf(l) === 0 || norm_(b.name) === l || b.id === label) return b;
  }
  return null;
}

function colVal_(block, m, key) {
  const i = colIndex_(block, key);
  return i < 0 ? 0 : (block.months[m].vals[i] || 0);
}

/* ======================= USTAWIENIA I TERMINY ======================= */

function parseYm_(v) {
  if (isDate_(v)) return v.getFullYear() * 12 + v.getMonth();
  const s = String(v === null || v === undefined ? '' : v).replace(/^'/, '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-./](\d{1,2})/);
  if (m) return (+m[1]) * 12 + (+m[2] - 1);
  m = s.match(/^\d{1,2}[-./](\d{1,2})[-./](\d{4})$/);
  if (m) return (+m[2]) * 12 + (+m[1] - 1);
  m = s.match(/^(\d{1,2})[-./](\d{4})$/);
  if (m) return (+m[2]) * 12 + (+m[1] - 1);
  return null;
}

function parseDate_(v) {
  if (isDate_(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v === null || v === undefined ? '' : v).replace(/^'/, '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function parseSettings_(v) {
  const s = {
    year: null, sheetPattern: CFG.DEFAULT_PATTERN, warnPct: 80, salary: null,
    gross: null, kup: 250, pit2: true, taxBase: null, taxBaseAsOf: null, payments: [],
    baselineMonths: 6, forecastMonths: 6, limits: [], commitments: [], incomes: [], quick: [], inflows: [],
    sectionRows: {}, missingSheet: !v
  };
  if (!v) return s;
  const keyMap = {
    'ROK': 'year', 'NAZWA ZAKŁADKI': 'sheetPattern',
    'PRÓG OSTRZEŻENIA (%)': 'warnPct', 'PENSJA DO PROGNOZY (NETTO)': 'salary',
    'MIESIĘCY DO ŚREDNIEJ': 'baselineMonths', 'MIESIĘCY PROGNOZY': 'forecastMonths',
    'WYNAGRODZENIE BRUTTO (PODSTAWA)': 'gross', 'KOSZTY UZYSKANIA PRZYCHODU (MIES.)': 'kup',
    'PIT-2 (KWOTA ZMNIEJSZAJĄCA 300 ZŁ)': 'pit2', 'PODSTAWA OPODATKOWANIA OD STYCZNIA (Z PASKA)': 'taxBase',
    'STAN PO WYPŁACIE Z MIESIĄCA (RRRR-MM)': 'taxBaseAsOf'
  };
  const numeric = { year: 1, warnPct: 1, salary: 1, baselineMonths: 1, forecastMonths: 1, gross: 1, kup: 1, taxBase: 1 };
  let section = null;
  for (let r = 0; r < v.length; r++) {
    const a = norm_(v[r][0]);
    if (!a) continue;
    if (a === 'LIMITY MIESIĘCZNE') { section = 'limits'; s.sectionRows.limits = r + 1; continue; }
    if (a === 'WPŁYWY') { section = 'inflows'; continue; }
    if (a === 'PŁATNOŚCI CYKLICZNE') { section = 'payments'; s.sectionRows.payments = r + 1; continue; }
    if (a === 'ZOBOWIĄZANIA (RATY)') { section = 'commitments'; continue; }
    if (a === 'DODATKOWE DOCHODY') { section = 'incomes'; continue; }
    if (a === 'SZYBKIE PRZYCISKI') { section = 'quick'; continue; }
    if (a === 'PARAMETR' || a === 'NAZWA' || a === 'ETYKIETA') continue;
    if (keyMap[a]) {
      const k = keyMap[a];
      if (numeric[k]) { const n = toNum_(v[r][1]); if (n !== null) s[k] = n; }
      else if (k === 'pit2') s.pit2 = !/^(NIE|N|NO|FALSE)$/i.test(String(v[r][1]).trim());
      else if (k === 'taxBaseAsOf') s.taxBaseAsOf = parseYm_(v[r][1]);
      else if (!isEmpty_(v[r][1])) s[k] = String(v[r][1]).trim();
      continue;
    }
    const name = String(v[r][0]).trim();
    if (section === 'limits') {
      const limit = toNum_(v[r][3]);
      if (limit === null) continue;
      s.limits.push({
        row: r + 1, name: name, block: String(v[r][1] || '').trim(), cols: String(v[r][2] || 'RAZEM').trim(),
        limit: limit, active: !/^(NIE|N|NO|FALSE)$/i.test(String(v[r][4]).trim())
      });
    } else if (section === 'payments') {
      s.payments.push({
        row: r + 1, name: name, block: String(v[r][1] || '').trim(), col: String(v[r][2] || '').trim(),
        day: Math.min(31, Math.max(1, Math.round(toNum_(v[r][3]) || 1))), every: Math.max(1, Math.round(toNum_(v[r][4]) || 1)),
        from: parseYm_(v[r][5]), amount: toNum_(v[r][6]), credit: toNum_(v[r][7]) || 0,
        invoiceDay: (function (d) { return d >= 1 && d <= 31 ? Math.round(d) : null; })(toNum_(v[r][8]))   // dzień wystawienia faktury (opcjonalnie)
      });
    } else if (section === 'inflows') {
      s.inflows.push({ label: name, block: String(v[r][1] || '').trim(), col: String(v[r][2] || '').trim(),
        sign: /^(MINUS|-|−|–)$/i.test(String(v[r][3] || '').trim()) ? -1 : 1, icon: String(v[r][4] || '').trim() });
    } else if (section === 'quick') {
      s.quick.push({ label: name, block: String(v[r][1] || '').trim(), col: String(v[r][2] || '').trim(), icon: String(v[r][3] || '').trim() });
    } else if (section === 'commitments' || section === 'incomes') {
      s[section].push({ name: name, amount: toNum_(v[r][1]) || 0, from: parseYm_(v[r][2]), to: parseYm_(v[r][3]), note: String(v[r][4] || '').trim() });
    }
  }
  return s;
}

function parseDeadlines_(v) {
  const out = [];
  if (!v) return out;
  let started = false;
  for (let r = 0; r < v.length; r++) {
    if (!started) { if (norm_(v[r][0]) === 'NAZWA') started = true; continue; }
    if (isEmpty_(v[r][0])) continue;
    const date = parseDate_(v[r][1]);
    if (!date) continue;
    // „Pokaż alert (dni przed)”: liczba dni; przy kilku liczbach brana jest największa
    const nums = (String(v[r][4] === undefined || v[r][4] === null ? '' : v[r][4]).match(/\d+/g) || ['60']).map(Number);
    const alertDays = Math.max.apply(null, nums);
    out.push({
      name: String(v[r][0]).trim(), date: date, amount: toNum_(v[r][2]) || 0,
      yearly: /rocz|rok|year/i.test(String(v[r][3] || '')), alertDays: alertDays, note: String(v[r][5] || '').trim()
    });
  }
  return out;
}

/* ============================ MODEL ============================ */

function median_(arr) {
  const a = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function r2_(x) { return Math.round(x * 100) / 100; }

function ymLabel_(ymi) { return CFG.MONTH_SHORT[ymi % 12] + ' ' + Math.floor(ymi / 12); }

function activeSum_(list, ymi) {
  return list.reduce(function (s, x) {
    const on = (x.from === null || ymi >= x.from) && (x.to === null || ymi <= x.to);
    return s + (on ? x.amount : 0);
  }, 0);
}

/* ============================ PODATEK (UMOWA O PRACĘ) ============================ */
// Skala 2026: 12% do 120 000 zł dochodu, 32% od nadwyżki, kwota zmniejszająca 300 zł/mies. (PIT-2).
// ZUS pracownika 13,71%, składka zdrowotna 9% (nieodliczana). Limit 30-krotności ZUS pominięty.
const TAX = { threshold: 120000, low: 0.12, high: 0.32, reduce: 300, zus: 0.1371, health: 0.09 };

/** Jedna wypłata: brutto → netto przy danej podstawie opodatkowania narastająco. */
function payroll_(gross, cumBase, s) {
  const zus = gross * TAX.zus;
  const health = (gross - zus) * TAX.health;
  const base = Math.max(0, Math.round(gross - zus - (s.kup || 0)));
  const room = Math.max(0, TAX.threshold - cumBase);
  const tax = Math.max(0, Math.round(TAX.low * Math.min(base, room) + TAX.high * Math.max(0, base - room) - (s.pit2 ? TAX.reduce : 0)));
  return { net: gross - zus - health - tax, base: base, tax: tax };
}

/** Odwrotność: jakie brutto daje takie netto (wyszukiwanie połówkowe). */
function grossFromNet_(net, cumBase, s) {
  if (!(net > 0)) return 0;
  let lo = 0, hi = net * 3;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (payroll_(mid, cumBase, s).net < net) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function buildModel_(ctx) {
  const year = ctx.year, today = ctx.today, settings = ctx.settings;
  const B = ctx.cur.blocks;
  const warnings = ctx.cur.warnings.slice();
  if (settings.missingSheet) warnings.push('Brak zakładki „Ustawienia” – używam wartości domyślnych.');
  const ty = today.getFullYear(), tm = today.getMonth(), td = today.getDate();
  const curIdx = ty === year ? tm : (ty > year ? 12 : -1);
  const todayYmi = ty * 12 + tm;

  const expenseDefs = CFG.BLOCKS.filter(function (d) { return d.id && d.expense && B[d.id]; });
  CFG.BLOCKS.forEach(function (d) {
    if (d.id && (d.expense || d.id === 'netto') && !B[d.id]) warnings.push('Nie znalazłem bloku „' + d.name + '” w arkuszu.');
  });
  const netto = B.netto;

  /* --- miesiące: dane rzeczywiste --- */
  const months = [];
  for (let m = 0; m < 12; m++) {
    const byBlock = {};
    let exp = 0, any = false;
    expenseDefs.forEach(function (d) {
      const mm = B[d.id].months[m];
      byBlock[d.id] = r2_(mm.total);
      exp += mm.total;
      any = any || mm.hasData;
    });
    const income = netto ? colVal_(netto, m, 'PENSJA') : 0;
    const incomeHas = netto ? !isEmpty_(netto.months[m].vals[colIndex_(netto, 'PENSJA')]) : false;
    const sheetSum = netto ? netto.months[m].vals[colIndex_(netto, 'SUMA WYDATKÓW')] : null;
    if (any && typeof sheetSum === 'number' && Math.abs(sheetSum - exp) > 1) {
      warnings.push(CFG.MONTH_NAME[m] + ': suma wydatków w arkuszu (' + r2_(sheetSum) + ') różni się od wyliczonej przez dashboard (' + r2_(exp) + ').');
    }
    months.push({
      m: m, label: CFG.MONTH_SHORT[m], name: CFG.MONTH_NAME[m],
      income: r2_(income), expenses: r2_(exp), left: r2_(income - exp),
      hasData: any || incomeHas, byBlock: byBlock,
      status: m < curIdx ? 'actual' : (m === curIdx ? 'current' : 'future')
    });
  }

  /* --- typowy miesiąc (mediana) --- */
  const nBase = Math.max(1, settings.baselineMonths || 6);
  let samples = []; // {sheet, m}
  months.forEach(function (x) { if (x.status === 'actual' && x.hasData) samples.push({ blocks: B, m: x.m, income: x.income }); });
  let usedPrev = false;
  if (samples.length < nBase && ctx.loadPrev) {
    const prev = ctx.loadPrev();
    if (prev) {
      usedPrev = true;
      const prevSamples = [];
      for (let m = 0; m < 12; m++) {
        const anyPrev = Object.keys(prev.blocks).some(function (k) { return prev.blocks[k].months[m].hasData; });
        if (anyPrev) prevSamples.push({ blocks: prev.blocks, m: m, income: prev.blocks.netto ? colVal_(prev.blocks.netto, m, 'PENSJA') : 0 });
      }
      samples = prevSamples.concat(samples);
    }
  }
  const baseSamples = samples.slice(-nBase);
  const baseline = {};
  expenseDefs.forEach(function (d) {
    if (d.baseline === 'zero') { baseline[d.id] = 0; return; }
    if (d.baseline === 'commitments') { baseline[d.id] = null; return; }
    baseline[d.id] = r2_(median_(baseSamples.map(function (s) {
      const blk = s.blocks[d.id];
      if (!blk) return null;
      let v = blk.months[s.m].total;
      (d.excludeFromBaseline || []).forEach(function (k) { v -= colVal_(blk, s.m, k); });
      return v;
    })));
  });
  const incomeSamples = samples.filter(function (s) { return s.income > 0; }).map(function (s) { return s.income; });

  /* --- podatek: podstawa opodatkowania narastająco (szacunek z kwot netto albo z paska) --- */
  const ts = { kup: settings.kup, pit2: settings.pit2 };
  const lastActual = Math.min(curIdx, 11);
  let cumBase = 0, taxSource = 'estimate', crossedInActual = null;
  const overrideAt = settings.taxBase !== null && settings.taxBaseAsOf !== null && Math.floor(settings.taxBaseAsOf / 12) === year
    ? settings.taxBaseAsOf % 12 : null;
  const estGross = [];
  for (let m = 0; m <= lastActual; m++) {
    if (overrideAt !== null && m <= overrideAt) {
      if (m === overrideAt) { cumBase = settings.taxBase; taxSource = 'payslip'; }
      continue;
    }
    const net = months[m].income;
    if (!(net > 0)) continue;
    const g = grossFromNet_(net, cumBase, ts);
    const pr = payroll_(g, cumBase, ts);
    if (cumBase < TAX.threshold && cumBase + pr.base >= TAX.threshold) crossedInActual = m;
    cumBase += pr.base;
    if (months[m].status === 'actual') estGross.push(g);
  }
  const grossA = settings.gross || grossFromNet_(settings.salary || median_(incomeSamples) || 0, 0, ts);
  const grossB = Math.max(grossA, estGross.length ? estGross.reduce(function (a, b) { return a + b; }, 0) / estGross.length : grossA);
  const netA = payroll_(grossA, 0, ts).net, netB = payroll_(grossB, 0, ts).net;
  const baseIncome = netA;

  /* --- terminy --- */
  const t0 = Date.UTC(ty, tm, td);
  const deadlines = ctx.deadlines.map(function (d) {
    let y = d.date.getFullYear();
    const mo = d.date.getMonth(), da = d.date.getDate();
    let t = Date.UTC(y, mo, da);
    while (d.yearly && t < t0) { y++; t = Date.UTC(y, mo, da); }
    const daysLeft = Math.round((t - t0) / 864e5);
    const monthsLeft = (y - ty) * 12 + (mo - tm);
    return {
      name: d.name, amount: d.amount, yearly: d.yearly, alertDays: d.alertDays, note: d.note,
      alert: daysLeft >= 0 && daysLeft <= d.alertDays,
      date: y + '-' + ('0' + (mo + 1)).slice(-2) + '-' + ('0' + da).slice(-2),
      ymi: y * 12 + mo, daysLeft: daysLeft, monthsLeft: monthsLeft,
      monthly: daysLeft < 0 ? 0 : r2_(monthsLeft <= 0 ? d.amount : d.amount / monthsLeft)
    };
  }).filter(function (d) { return d.daysLeft >= -30; })
    .sort(function (a, b) { return a.daysLeft - b.daysLeft; });

  /* --- prognoza --- */
  const horizon = Math.max(1, settings.forecastMonths || 6);
  const startYmi = curIdx >= 12 ? null : (curIdx < 0 ? year * 12 : todayYmi);
  const forecast = [];
  const cum = { A: cumBase, B: cumBase };
  const cross = { A: null, B: null };
  let impactA = 0, impactB = 0;
  if (startYmi !== null) {
    for (let i = 0; i < Math.max(horizon, 12 * (year + 1) + 12 - startYmi); i++) {
      const ymi = startYmi + i;
      const y = Math.floor(ymi / 12), m = ymi % 12;
      const isCurrent = ymi === todayYmi && y === year;
      const items = [];
      const byBlock = {};
      let exp = 0;
      expenseDefs.forEach(function (d) {
        let v = d.baseline === 'commitments' ? activeSum_(settings.commitments, ymi) : baseline[d.id];
        if (isCurrent) v = Math.max(v, B[d.id].months[m].total);
        byBlock[d.id] = r2_(v);
        exp += v;
      });
      deadlines.forEach(function (d) {
        if (d.ymi === ymi && d.daysLeft >= 0) { exp += d.amount; items.push(d.name + ' ' + Math.round(d.amount) + ' zł'); }
      });
      settings.commitments.forEach(function (c) {
        if (c.from === ymi && ymi > todayYmi) items.push('start: ' + c.name + ' (' + Math.round(c.amount) + ' zł)');
        if (c.to === ymi) items.push('ostatnia rata: ' + c.name);
      });
      const extra = activeSum_(settings.incomes, ymi);
      settings.incomes.forEach(function (c) { if (c.from === ymi && c.amount) items.push('start: ' + c.name + ' (+' + Math.round(c.amount) + ' zł)'); });
      if (m === 0) { cum.A = 0; cum.B = 0; }                // nowy rok podatkowy
      const inc = {}, crossed = {};
      ['A', 'B'].forEach(function (v) {
        const g = v === 'A' ? grossA : grossB;
        let net;
        if (isCurrent) {
          const act = months[m].income;
          if (act >= 0.6 * netA) net = 0;                     // wypłata już wpłynęła (jest w arkuszu)
          else net = payroll_(grossA, cum[v], ts).net;       // czeka na wypłatę: zawsze pensja podstawowa
          const before = cum[v];
          if (net) {
            cum[v] += payroll_(grossA, before, ts).base;
            const lost = payroll_(grossA, 0, ts).net - net;
            if (v === 'A') impactA += lost; else impactB += lost;
          }
          if (before < TAX.threshold && cum[v] >= TAX.threshold && !cross[v]) { cross[v] = ymi; crossed[v] = true; }
          inc[v] = act + net + extra;
        } else {
          const pr = payroll_(g, cum[v], ts);
          if (cum[v] < TAX.threshold && cum[v] + pr.base >= TAX.threshold && !cross[v]) { cross[v] = ymi; crossed[v] = true; }
          if (y === year) { if (v === 'A') impactA += payroll_(g, 0, ts).net - pr.net; else impactB += payroll_(g, 0, ts).net - pr.net; }
          cum[v] += pr.base;
          inc[v] = pr.net + extra;
        }
      });
      if (isCurrent && months[m].income < 0.6 * netA) items.push('czeka na wypłatę');
      if (crossed.A || crossed.B) items.push('drugi próg podatkowy' + (crossed.A && crossed.B ? '' : crossed.A ? ' (wariant ostrożny)' : ' (wariant ze średnią)'));
      forecast.push({
        ymi: ymi, y: y, m: m, label: ymLabel_(ymi), isCurrent: isCurrent, inHorizon: i < horizon,
        incomeA: r2_(inc.A), incomeB: r2_(inc.B), expenses: r2_(exp),
        leftA: r2_(inc.A - exp), leftB: r2_(inc.B - exp),
        income: r2_(inc.A), left: r2_(inc.A - exp),
        crossA: !!crossed.A, crossB: !!crossed.B, items: items, byBlock: byBlock
      });
    }
  }
  const fcByYmi = {};
  forecast.forEach(function (f) { fcByYmi[f.ymi] = f; });

  /* --- rok: rzeczywiste + prognoza --- */
  const yearMonths = months.map(function (x) {
    const f = fcByYmi[year * 12 + x.m];
    const act = x.status === 'actual';
    return {
      label: x.label, status: x.status,
      incomeA: act ? x.income : (f ? f.incomeA : x.income),
      incomeB: act ? x.income : (f ? f.incomeB : x.income),
      expenses: act ? x.expenses : (f ? f.expenses : x.expenses),
      crossA: !!(f && f.crossA) || (act && crossedInActual === x.m),
      crossB: !!(f && f.crossB) || (act && crossedInActual === x.m),
      byBlock: act ? x.byBlock : (f ? f.byBlock : x.byBlock),
      actualIncome: x.income, actualExpenses: x.expenses
    };
  });
  yearMonths.forEach(function (x) { x.income = x.incomeA; x.leftA = r2_(x.incomeA - x.expenses); x.leftB = r2_(x.incomeB - x.expenses); x.left = x.leftA; });

  const complete = months.filter(function (x) { return x.status === 'actual' && x.hasData; });
  const ytd = complete.reduce(function (a, x) { a.income += x.income; a.expenses += x.expenses; return a; }, { income: 0, expenses: 0 });
  ytd.left = ytd.income - ytd.expenses;
  ytd.rate = ytd.income ? ytd.left / ytd.income : 0;
  ytd.months = complete.length;
  const yearEnd = yearMonths.reduce(function (a, x) { a.incomeA += x.incomeA; a.incomeB += x.incomeB; a.expenses += x.expenses; return a; }, { incomeA: 0, incomeB: 0, expenses: 0 });
  yearEnd.leftA = yearEnd.incomeA - yearEnd.expenses;
  yearEnd.leftB = yearEnd.incomeB - yearEnd.expenses;
  yearEnd.income = yearEnd.incomeA; yearEnd.left = yearEnd.leftA;

  /* --- symulacja: ile przybędzie od początku bieżącego miesiąca (narastająco) --- */
  let savings = null;
  if (forecast.length) {
    let cA = 0, cB = 0;
    const series = forecast.map(function (f) {
      cA += f.leftA; cB += f.leftB;
      return { ymi: f.ymi, label: f.label, incomeA: f.incomeA, incomeB: f.incomeB, expenses: f.expenses, leftA: f.leftA, leftB: f.leftB, cumA: Math.round(cA), cumB: Math.round(cB), items: f.items.filter(function (t) { return t !== 'czeka na wypłatę'; }) };
    });
    const checkpoints = [year * 12 + 11, (year + 1) * 12 + 2, (year + 1) * 12 + 5, (year + 1) * 12 + 8, (year + 1) * 12 + 11];
    const lastDay = function (ymi) { return new Date(Math.floor(ymi / 12), ymi % 12 + 1, 0).getDate(); };
    savings = {
      fromLabel: '1 ' + ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'][forecast[0].m] + ' ' + forecast[0].y,
      series: series,
      points: checkpoints.map(function (c) {
        const s = series.filter(function (x) { return x.ymi === c; })[0];
        if (!s) return null;
        return { ymi: c, date: lastDay(c) + '.' + ('0' + (c % 12 + 1)).slice(-2) + '.' + Math.floor(c / 12), quarter: 'Q' + (Math.floor((c % 12) / 3) + 1) + ' ' + Math.floor(c / 12), cumA: s.cumA, cumB: s.cumB };
      }).filter(Boolean)
    };
  }

  /* --- płatności cykliczne: termin, status, kwota --- */
  let prevYear;
  const yearBlocks = function (y) {
    if (y === year) return B;
    if (y === year - 1 && ctx.loadPrev) { if (prevYear === undefined) prevYear = ctx.loadPrev(); return prevYear ? prevYear.blocks : null; }
    return null;
  };
  const cellOf = function (ymi, blockId, key) {
    const bl = yearBlocks(Math.floor(ymi / 12));
    const blk = bl && bl[blockId];
    const i = blk ? colIndex_(blk, key) : -1;
    return i < 0 ? null : blk.months[ymi % 12].vals[i];   // liczba (także 0) = zapłacone; null = puste albo tekst
  };
  const dueUTC = function (ymi, day) { const y = Math.floor(ymi / 12), m = ymi % 12; return Date.UTC(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())); };
  const isoOf = function (t) { const d = new Date(t); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); };
  const payments = settings.payments.map(function (p) {
    const blk = findBlockByLabel_(B, p.block);
    const ci = blk ? colIndex_(blk, p.col) : -1;
    if (ci < 0) { warnings.push('Płatność „' + p.name + '”: nie znalazłem kolumny „' + p.col + '” w bloku „' + p.block + '”.'); return null; }
    const key = blk.cols[ci].key, f = p.every;
    const anchor = p.from !== null ? p.from : (f === 1 ? todayYmi - 24 : todayYmi);   // co miesiąc: każdy miesiąc jest terminem
    const isDue = function (ymi) { return ymi >= anchor && ((ymi - anchor) % f + f) % f === 0; };
    // Okres = miesiąc komórki w arkuszu. Bez dnia faktury termin jest w tym samym miesiącu.
    // Z dniem faktury późniejszym niż dzień płatności (np. faktura 26., termin 10.) komórka to miesiąc faktury
    // (wtedy użytkownik płaci), a termin wypada w następnym miesiącu.
    const offset = p.invoiceDay && p.invoiceDay > p.day ? 1 : 0;
    const dim = function (ymi) { return new Date(Math.floor(ymi / 12), ymi % 12 + 1, 0).getDate(); };
    const issuedUTC = function (ymi) { return Date.UTC(Math.floor(ymi / 12), ymi % 12, p.invoiceDay ? Math.min(p.invoiceDay, dim(ymi)) : 1); };
    const dueOf = function (ymi) { return dueUTC(ymi + offset, p.day); };
    let last = null;                                         // bieżący okres: ostatni, który już się zaczął (albo ma wystawioną fakturę)
    for (let x = todayYmi; x >= todayYmi - f - 1; x--) if (isDue(x) && issuedUTC(x) <= t0) { last = x; break; }
    let start = last === null ? todayYmi : last;
    if (offset && last !== null) for (let x = last - 1; x >= last - f; x--) if (isDue(x)) { start = x; break; }   // poprzedni okres może mieć termin jeszcze przed nami
    // pierwszy niezapłacony termin od bieżącego okresu (zapłacone z wyprzedzeniem są pomijane)
    let next = null, lastPaid = null;
    for (let x = start, k = 0; k < 24 * f + 1; x++, k++) {
      if (!isDue(x)) continue;
      const v = cellOf(x, blk.id, key);
      if (v === null) { next = x; break; }
      lastPaid = { ymi: x, v: v };
    }
    if (next === null) next = (lastPaid ? lastPaid.ymi : todayYmi) + f;
    const currentPaid = last !== null && lastPaid !== null && lastPaid.ymi >= last;
    const daysLeft = Math.round((dueOf(next) - t0) / 864e5);
    const invoiceAt = p.invoiceDay ? issuedUTC(next) : null;
    let state;
    if (currentPaid) state = daysLeft > 10 ? 'paid' : daysLeft <= 5 ? 'urgent' : 'soon';
    else state = daysLeft < 0 ? 'overdue' : daysLeft <= 5 ? 'urgent' : daysLeft <= 10 ? 'soon' : 'ok';
    // kwota: z Ustawień albo jak w poprzednim terminie (co „Co ile miesięcy”)
    let estimate = p.amount;
    if (estimate === null) {
      for (let x = next - f, k = 0; k < 12 && estimate === null; x -= f, k++) { const v = cellOf(x, blk.id, key); if (v !== null && v > 0) estimate = v; }
      for (let x = next - 1, k = 0; k < 12 && estimate === null; x--, k++) { const v = cellOf(x, blk.id, key); if (v !== null && v > 0) estimate = v; }
    }
    return {
      row: p.row, name: p.name, key: blk.id + '::' + key, blockId: blk.id, block: blk.name, col: blk.cols[ci].name,
      day: p.day, every: f, from: p.from === null ? null : ymLabel_(p.from), fromYm: p.from === null ? null : Math.floor(p.from / 12) + '-' + ('0' + (p.from % 12 + 1)).slice(-2),
      amount: p.amount, credit: r2_(p.credit), estimate: estimate === null ? null : r2_(estimate),
      toPay: estimate === null ? null : r2_(Math.max(0, estimate - p.credit)),
      period: Math.floor(next / 12) + '-' + ('0' + (next % 12 + 1)).slice(-2), periodMonth: CFG.MONTH_NAME[next % 12], periodYear: Math.floor(next / 12),
      dueDate: isoOf(dueOf(next)), daysLeft: daysLeft, state: state,
      invoiceDay: p.invoiceDay, invoiceDate: invoiceAt === null ? null : isoOf(invoiceAt), waiting: invoiceAt !== null && invoiceAt > t0,
      paid: currentPaid ? { month: CFG.MONTH_NAME[lastPaid.ymi % 12], amount: r2_(lastPaid.v) } : null
    };
  }).filter(Boolean).sort(function (a, b) {
    const ord = { overdue: 0, urgent: 1, soon: 2, ok: 3, paid: 4 };
    return ord[a.state] - ord[b.state] || a.daysLeft - b.daysLeft;
  });

  const lbl = function (ymi) { return ymi === null ? null : { ymi: ymi, label: ymLabel_(ymi), month: CFG.MONTH_NAME[ymi % 12], year: Math.floor(ymi / 12) }; };
  const taxInfo = {
    threshold: TAX.threshold, cumBase: Math.round(cumBase), source: taxSource,
    crossedIn: crossedInActual === null ? null : lbl(year * 12 + crossedInActual),
    crossA: lbl(cross.A), crossB: lbl(cross.B),
    grossA: Math.round(grossA), grossB: Math.round(grossB), netA: r2_(netA), netB: r2_(netB),
    netAboveA: r2_(payroll_(grossA, 1e9, ts).net), dropA: r2_(netA - payroll_(grossA, 1e9, ts).net),
    impactA: Math.round(impactA), impactB: Math.round(impactB)
  };

  /* --- limity --- */
  const warnPct = settings.warnPct || 80;
  function statusOf(v, lim) { return v > lim ? 'over' : (v >= lim * warnPct / 100 ? 'warn' : 'ok'); }
  const limits = settings.limits.filter(function (l) { return l.active; }).map(function (l) {
    const blk = findBlockByLabel_(B, l.block);
    if (!blk) { warnings.push('Limit „' + l.name + '”: nie znalazłem bloku „' + l.block + '”.'); return null; }
    const keys = l.cols.split('+').map(norm_).filter(Boolean);
    const whole = !keys.length || keys.indexOf('RAZEM') >= 0;
    keys.forEach(function (k) { if (k !== 'RAZEM' && colIndex_(blk, k) < 0) warnings.push('Limit „' + l.name + '”: brak kolumny „' + k + '” w bloku „' + blk.title + '”.'); });
    const series = blk.months.map(function (mm, m) {
      return r2_(whole ? mm.total : keys.reduce(function (s, k) { return s + colVal_(blk, m, k); }, 0));
    });
    const doneIdx = months.filter(function (x) { return x.status === 'actual' && blk.months[x.m].hasData; }).map(function (x) { return x.m; });
    const value = curIdx >= 0 && curIdx < 12 ? series[curIdx] : null;
    return {
      row: l.row, name: l.name, limit: l.limit, value: value, blockId: blk.id, cols: whole ? null : keys,
      pct: value === null ? null : r2_(value / l.limit * 100),
      status: value === null ? 'ok' : statusOf(value, l.limit),
      overCount: doneIdx.filter(function (m) { return series[m] > l.limit; }).length,
      monthsCount: doneIdx.length,
      avg: r2_(doneIdx.length ? doneIdx.reduce(function (s, m) { return s + series[m]; }, 0) / doneIdx.length : 0),
      series: series
    };
  }).filter(Boolean);

  /* --- struktura wydatków --- */
  const lastIdx = Math.min(curIdx, 11);
  const blocksOut = expenseDefs.map(function (d) {
    const blk = B[d.id];
    const perMonth = blk.months.map(function (mm) { return r2_(mm.total); });
    const cols = blk.cols.map(function (c, i) {
      return { name: c.name, perMonth: blk.months.map(function (mm) { return r2_(mm.vals[i] || 0); }) };
    }).filter(function (c) { return c.perMonth.some(function (x) { return x !== 0; }); });
    return { id: d.id, name: d.name, perMonth: perMonth, cols: cols, baseline: baseline[d.id] };
  });

  let streaming = null;
  if (B.streaming) {
    const lastFull = complete.length ? complete[complete.length - 1].m : null;
    streaming = {
      lastMonth: lastFull === null ? 0 : r2_(B.streaming.months[lastFull].total),
      ytd: r2_(B.streaming.months.reduce(function (s, mm, m) { return s + (m <= lastIdx ? mm.total : 0); }, 0))
    };
  }

  const limitDefs = settings.limits.map(function (l) {
    const blk = findBlockByLabel_(B, l.block);
    const keys = l.cols.split('+').map(norm_).filter(Boolean);
    const whole = !keys.length || keys.indexOf('RAZEM') >= 0;
    return { row: l.row, name: l.name, limit: l.limit, active: l.active, blockId: blk ? blk.id : null, cols: whole ? null : keys };
  });

  /* --- formularz wpisów: kategorie i szybkie przyciski --- */
  const categories = [];
  CFG.BLOCKS.forEach(function (d) {
    if (!d.id || !B[d.id]) return;
    const blk = B[d.id];
    if (d.id === 'netto') {
      const i = colIndex_(blk, 'PENSJA');
      if (i >= 0) categories.push({ key: 'netto::PENSJA', blockId: 'netto', block: 'Dochód', col: 'Pensja i dodatki', kind: 'income' });
      return;
    }
    blk.cols.forEach(function (c) {
      if (!c.unnamed) categories.push({ key: d.id + '::' + c.key, blockId: d.id, block: blk.name, col: c.name, kind: 'expense' });
    });
  });
  const inflows = settings.inflows.map(function (q) {
    const blk = findBlockByLabel_(B, q.block);
    const i = blk ? colIndex_(blk, q.col) : -1;
    if (i < 0) { warnings.push('Wpływ „' + q.label + '”: nie znalazłem kolumny „' + q.col + '” w bloku „' + q.block + '”.'); return null; }
    return { label: q.label, icon: q.icon, sign: q.sign, key: blk.id + '::' + blk.cols[i].key, category: blk.name + ' / ' + blk.cols[i].name };
  }).filter(Boolean);
  if (!inflows.length && B.netto && colIndex_(B.netto, 'PENSJA') >= 0) {
    inflows.push({ label: 'Pensja i dodatki', icon: '💼', sign: 1, key: 'netto::PENSJA', category: B.netto.name + ' / PENSJA' });
  }
  // kolumny „Inne”/„Różne” każdego bloku – dla przycisku „Różne” z wyborem bloku
  const otherCols = [];
  expenseDefs.forEach(function (d) {
    if (d.id === 'kredyt') return;
    const blk = B[d.id];
    let c = blk.cols.filter(function (x) { return !x.unnamed && /^(INNE|RÓŻNE)/.test(x.key); })[0];
    if (!c && blk.cols.filter(function (x) { return !x.unnamed; }).length === 1) c = blk.cols.filter(function (x) { return !x.unnamed; })[0];
    if (c) otherCols.push({ blockId: d.id, block: blk.name, key: d.id + '::' + c.key, col: c.name });
  });
  const quick = settings.quick.map(function (q) {
    if (q.col === '*') return { label: q.label, icon: q.icon, key: '*' };
    const blk = findBlockByLabel_(B, q.block);
    const i = blk ? colIndex_(blk, q.col) : -1;
    if (i < 0) { warnings.push('Szybki przycisk „' + q.label + '”: nie znalazłem kolumny „' + q.col + '” w bloku „' + q.block + '”.'); return null; }
    return { label: q.label, icon: q.icon, key: blk.id + '::' + blk.cols[i].key };
  }).filter(Boolean);

  /* --- do uzupełnienia / do zapłaty --- */
  const missing = [], unpaid = [];
  Object.keys(B).forEach(function (id) {
    const blk = B[id];
    blk.months.forEach(function (mm, m) {
      if (m > lastIdx) return;
      mm.texts.forEach(function (t) { missing.push({ block: blk.name, col: t.col, month: CFG.MONTH_NAME[m], text: t.text }); });
      mm.unpaid.forEach(function (u) { unpaid.push({ block: blk.name, col: u.col, month: CFG.MONTH_NAME[m], amount: u.amount, note: u.note }); });
    });
  });

  return {
    generatedAt: today.toISOString(),
    today: { y: ty, m: tm, d: td },
    year: year, currentMonth: curIdx,
    monthNames: CFG.MONTH_NAME, monthShort: CFG.MONTH_SHORT,
    baseIncome: baseIncome, baseline: baseline, baselineMonths: baseSamples.length, usedPrevYear: usedPrev,
    tax: taxInfo,
    months: months, yearMonths: yearMonths,
    ytd: ytd, yearEnd: yearEnd,
    current: curIdx >= 0 && curIdx < 12 ? {
      name: CFG.MONTH_NAME[curIdx], income: months[curIdx].income, expenses: months[curIdx].expenses,
      expectedIncome: fcByYmi[todayYmi] ? fcByYmi[todayYmi].incomeA : months[curIdx].income,
      expectedExpenses: fcByYmi[todayYmi] ? fcByYmi[todayYmi].expenses : months[curIdx].expenses
    } : null,
    forecast: forecast.filter(function (f) { return f.inHorizon; }),
    limits: limits, warnPct: warnPct,
    deadlines: deadlines,
    commitments: settings.commitments.map(function (c) {
      return { name: c.name, amount: c.amount, from: c.from === null ? null : ymLabel_(c.from), to: c.to === null ? null : ymLabel_(c.to) };
    }),
    blocks: blocksOut, streaming: streaming,
    savings: savings, payments: payments,
    categories: categories, quick: quick, otherCols: otherCols, inflows: inflows, limitDefs: limitDefs, entries: ctx.entries || [],
    missing: missing, unpaid: unpaid, warnings: warnings
  };
}

/* ============================ WPISY: ZAPIS DO ARKUSZA ============================ */
/*
 * Funkcje wywoływane ze strony (google.script.run): addEntry, undoEntry, refreshData.
 * Zwracają tekst JSON: { ok, error?, entry?, model? }.
 */

function refreshData() {
  return JSON.stringify(getDashboardData());
}

function addEntry(payload) {
  return withLock_(function (ss) {
    const entry = addEntry_(ss, payload || {});
    return { entry: entry };
  });
}

function undoEntry(id) {
  return withLock_(function (ss) {
    undoEntry_(ss, id);
    return {};
  });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Arkusz jest zajęty innym zapisem. Spróbuj za chwilę.' });
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const out = fn(ss);
    SpreadsheetApp.flush();
    out.ok = true;
    out.model = getDashboardData();
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  } finally {
    lock.releaseLock();
  }
}

function saveLimit(payload) {
  return withLock_(function (ss) { return { limit: saveLimit_(ss, payload || {}) }; });
}

function deleteLimit(payload) {
  return withLock_(function (ss) { deleteLimit_(ss, payload || {}); return {}; });
}

function savePayment(payload) {
  return withLock_(function (ss) { return { payment: savePayment_(ss, payload || {}) }; });
}

function deletePayment(payload) {
  return withLock_(function (ss) { deletePayment_(ss, payload || {}); return {}; });
}

function savePayment_(ss, p) {
  const sh = settingsSheet_(ss);
  const settings = parseSettings_(sh.getDataRange().getValues());
  const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new Error('Nadaj płatności nazwę.');
  const day = Math.round(Number(p.day));
  if (!(day >= 1 && day <= 31)) throw new Error('Dzień płatności musi być od 1 do 31.');
  const every = Math.round(Number(p.every) || 1);
  if ([1, 2, 3, 6, 12].indexOf(every) < 0) throw new Error('Wybierz, co ile miesięcy jest płatność.');
  const from = every > 1 ? parseYm_(p.from) : null;
  if (every > 1 && from === null) throw new Error('Podaj miesiąc najbliższej płatności.');
  const amount = p.amount === '' || p.amount === null || p.amount === undefined ? '' : Math.round(Number(p.amount) * 100) / 100;
  const credit = p.credit === '' || p.credit === null || p.credit === undefined ? '' : Math.round(Number(p.credit) * 100) / 100;
  if (amount !== '' && !(amount > 0)) throw new Error('Kwota musi być większa od zera albo pusta.');
  if (credit !== '' && !(credit >= 0)) throw new Error('Nadpłata nie może być ujemna.');

  const yearSheet = ss.getSheetByName(sheetName_(settings.sheetPattern, settings.year || new Date().getFullYear()));
  const blk = yearSheet ? parseYearSheet_(yearSheet.getDataRange().getValues(), null).blocks[p.blockId] : null;
  const ci = blk ? colIndex_(blk, p.col) : -1;
  if (ci < 0 || blk.cols[ci].unnamed) throw new Error('Wybierz blok i kolumnę, do której wpisujesz tę płatność.');
  const fromStr = from === null ? '' : Math.floor(from / 12) + '-' + ('0' + (from % 12 + 1)).slice(-2);
  const inv = p.invoiceDay === '' || p.invoiceDay === null || p.invoiceDay === undefined ? '' : Math.round(Number(p.invoiceDay));
  if (inv !== '' && !(inv >= 1 && inv <= 31)) throw new Error('Dzień faktury musi być od 1 do 31 albo pusty.');
  const row = [name, blk.title.replace(/\s*\d{4}\s*$/, ''), blk.cols[ci].name, day, every, fromStr, amount, credit === 0 ? '' : credit, inv];

  if (p.row) {
    const cur = settings.payments.filter(function (x) { return x.row === p.row; })[0];
    if (!cur || cur.name !== p.originalName) throw new Error('Płatności w arkuszu zmieniły się w międzyczasie. Odśwież stronę i spróbuj ponownie.');
    sh.getRange(p.row, 1, 1, 9).setValues([row]);
    return { row: p.row, name: name };
  }
  if (settings.payments.some(function (x) { return norm_(x.name) === norm_(name); })) throw new Error('Płatność „' + name + '” już istnieje.');
  const header = settings.sectionRows.payments;
  if (!header) throw new Error('Nie znalazłem sekcji „PŁATNOŚCI CYKLICZNE” w Ustawieniach.');
  const last = settings.payments.length ? Math.max.apply(null, settings.payments.map(function (x) { return x.row; })) : header + 1;
  sh.insertRowAfter(last);
  sh.getRange(last + 1, 1, 1, 9).setValues([row]);
  return { row: last + 1, name: name };
}

function deletePayment_(ss, p) {
  const sh = settingsSheet_(ss);
  const cur = parseSettings_(sh.getDataRange().getValues()).payments.filter(function (x) { return x.row === p.row; })[0];
  if (!cur || cur.name !== p.name) throw new Error('Płatności w arkuszu zmieniły się w międzyczasie. Odśwież stronę i spróbuj ponownie.');
  sh.deleteRow(p.row);
}

function settingsSheet_(ss) {
  const sh = ss.getSheetByName(CFG.SETTINGS_SHEET);
  if (!sh) throw new Error('Brak zakładki „' + CFG.SETTINGS_SHEET + '”.');
  return sh;
}

/** Sprawdza, czy pod wskazanym wierszem nadal jest ten sam limit (ktoś mógł edytować arkusz). */
function limitAtRow_(settings, row, name) {
  const l = settings.limits.filter(function (x) { return x.row === row; })[0];
  if (!l || l.name !== name) throw new Error('Limity w arkuszu zmieniły się w międzyczasie. Odśwież stronę i spróbuj ponownie.');
  return l;
}

function saveLimit_(ss, p) {
  const sh = settingsSheet_(ss);
  const settings = parseSettings_(sh.getDataRange().getValues());
  const limit = Math.round(Number(p.limit) * 100) / 100;
  if (!isFinite(limit) || limit <= 0) throw new Error('Limit musi być kwotą większą od zera.');
  const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new Error('Nadaj limitowi nazwę.');

  const yearSheet = ss.getSheetByName(sheetName_(settings.sheetPattern, settings.year || new Date().getFullYear()));
  if (!yearSheet) throw new Error('Nie znalazłem zakładki z wydatkami.');
  const blk = parseYearSheet_(yearSheet.getDataRange().getValues(), null).blocks[p.blockId];
  if (!blk) throw new Error('Wybierz kategorię limitu.');
  const keys = (p.cols || []).map(norm_).filter(Boolean);
  const names = keys.map(function (k) {
    const i = colIndex_(blk, k);
    if (i < 0) throw new Error('Nie znalazłem kolumny „' + k + '”.');
    return blk.cols[i].name;
  });
  const row = [name, blk.title.replace(/\s*\d{4}\s*$/, ''), names.length ? names.join(' + ') : 'RAZEM', limit, p.active === false ? 'NIE' : 'TAK'];

  if (p.row) {
    limitAtRow_(settings, p.row, p.originalName);
    sh.getRange(p.row, 1, 1, 5).setValues([row]);
    return { row: p.row, name: name };
  }
  if (settings.limits.some(function (l) { return norm_(l.name) === norm_(name); })) throw new Error('Limit o nazwie „' + name + '” już istnieje.');
  const header = settings.sectionRows.limits;
  if (!header) throw new Error('Nie znalazłem sekcji „LIMITY MIESIĘCZNE” w Ustawieniach.');
  const last = settings.limits.length ? Math.max.apply(null, settings.limits.map(function (l) { return l.row; })) : header + 1;
  sh.insertRowAfter(last);
  sh.getRange(last + 1, 1, 1, 5).setValues([row]);
  return { row: last + 1, name: name };
}

function deleteLimit_(ss, p) {
  const sh = settingsSheet_(ss);
  const settings = parseSettings_(sh.getDataRange().getValues());
  limitAtRow_(settings, p.row, p.name);
  sh.deleteRow(p.row);
}

function dateStr_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function fmtPl_(x) {
  return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
}

/** Liczba do formuły: całkowita bez przecinka, ułamkowa z separatorem dziesiętnym arkusza. */
function numStr_(x, sep) {
  return Number.isInteger(x) ? String(x) : (Math.round(x * 100) / 100).toFixed(2).replace('.', sep);
}

/** Separatory do sprawdzenia, w kolejności: z istniejącej formuły, potem z ustawień regionalnych arkusza. */
function decimalSeps_(ss, formula) {
  if (/\d,\d/.test(formula || '')) return [',', '.'];
  if (/\d\.\d/.test(formula || '')) return ['.', ','];
  let loc = '';
  try { loc = String(ss.getSpreadsheetLocale() || ''); } catch (e) { loc = ''; }
  return /^(pl|de|fr|es|it|nl|pt|ru|cs|sk|uk|sv|da|fi|nb|no|tr|ro|hu|hr|sl|bg|el|lt|lv|et)/i.test(loc) ? [',', '.'] : ['.', ','];
}

/** Tekst do komórki dziennika – bez zamiany na formułę/liczbę przez arkusz. */
function asText_(x) {
  if (typeof x === 'number') return x;
  const s = String(x === null || x === undefined ? '' : x);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

function normF_(f) {
  return String(f || '').replace(/\s+/g, '').replace(/,/g, '.').replace(/;/g, ',');
}

function unpaidNote_(amount, desc) {
  return 'niezapłacone: ' + fmtPl_(amount) + ' zł' + (desc ? ' – ' + desc : '');
}

function ensureLogSheet_(ss) {
  let sh = ss.getSheetByName(CFG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.LOG_SHEET);
  }
  if (sh.getLastRow() > 0 && isEmpty_(sh.getRange(1, 13).getValue())) {
    sh.getRange(1, 13, 1, 2).setValues([CFG.LOG_HEADER.slice(12)]);   // starszy dziennik: dopisz nowe nagłówki
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(CFG.LOG_HEADER);
    try {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, CFG.LOG_HEADER.length).setFontWeight('bold');
      sh.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm');
      sh.getRange('C:C').setNumberFormat('yyyy-mm-dd');
      sh.setColumnWidth(5, 240); sh.setColumnWidth(7, 220); sh.setColumnWidth(9, 260);
      sh.setColumnWidth(10, 160); sh.setColumnWidth(11, 200);
    } catch (e) { /* formatowanie jest opcjonalne */ }
  }
  return sh;
}

function parseLog_(v) {
  const out = [];
  if (!v) return out;
  for (let r = 1; r < v.length; r++) {
    const row = v[r];
    if (isEmpty_(row[0])) continue;
    const bought = parseDate_(row[2]);
    out.push({
      id: String(row[0]),
      added: isDate_(row[1]) ? row[1].toISOString() : '',
      date: bought ? dateStr_(bought) : '',
      kind: String(row[3] || ''),
      category: String(row[4] || ''),
      amount: toNum_(row[5]) || 0,
      desc: String(row[6] || ''),
      unpaid: /^TAK$/i.test(String(row[7] || '').trim()),
      undone: /cofni/i.test(String(row[11] || ''))
    });
  }
  return out.slice(-CFG.LOG_SHOW).reverse();
}

function addEntry_(ss, p) {
  let amount = Math.round(Number(p.amount) * 100) / 100;
  if (!isFinite(amount) || Math.abs(amount) > 1000000) throw new Error('Wpisz poprawną kwotę.');
  const date = parseDate_(p.date);
  if (!date) throw new Error('Wybierz datę zakupu.');
  let desc = String(p.desc || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts = String(p.key || '').split('::');
  if (parts.length !== 2) throw new Error('Wybierz kategorię.');

  const settings = parseSettings_(readSheetValues_(ss, CFG.SETTINGS_SHEET));
  // płatność cykliczna: zapis do miesiąca płatności (nie daty przelewu) i ewentualna nadpłata
  let payment = null, creditUsed = 0;
  if (p.paymentRow) {
    payment = settings.payments.filter(function (x) { return x.row === p.paymentRow && x.name === p.paymentName; })[0];
    if (!payment) throw new Error('Płatności w Ustawieniach zmieniły się w międzyczasie. Odśwież stronę.');
    if (payment.credit > 0 && amount > 0) {
      creditUsed = Math.round(Math.min(payment.credit, amount) * 100) / 100;
      desc = (desc ? desc + ' ' : '') + '(faktura ' + fmtPl_(amount) + ' zł, z nadpłaty ' + fmtPl_(creditUsed) + ' zł)';
      amount = Math.round((amount - creditUsed) * 100) / 100;
    }
  }
  if (amount === 0 && !creditUsed) throw new Error('Wpisz kwotę różną od zera.');
  const target = p.period ? parseYm_(p.period) : date.getFullYear() * 12 + date.getMonth();
  if (target === null) throw new Error('Nieprawidłowy miesiąc płatności.');
  const tYear = Math.floor(target / 12), tMonth = target % 12;
  const sheet = ss.getSheetByName(sheetName_(settings.sheetPattern, tYear));
  if (!sheet) throw new Error('Nie ma zakładki dla roku ' + tYear + '. ' + (p.period ? 'Utwórz ją, zanim zapłacisz za ten miesiąc.' : 'Sprawdź datę zakupu.'));
  const parsed = parseYearSheet_(sheet.getDataRange().getValues(), null);
  const blk = parsed.blocks[parts[0]];
  const ci = blk ? colIndex_(blk, parts[1]) : -1;
  if (ci < 0 || blk.cols[ci].unnamed) throw new Error('Nie znalazłem tej kategorii w zakładce „' + sheet.getName() + '”.');
  let sign = 1;
  const isIncome = p.kind === 'income';
  if (isIncome) {
    const inflow = settings.inflows.filter(function (q) {
      const b = findBlockByLabel_(parsed.blocks, q.block);
      return b && b.id === blk.id && norm_(q.col) === blk.cols[ci].key;
    })[0];
    if (!inflow && !(blk.id === 'netto' && blk.cols[ci].key === 'PENSJA' && !settings.inflows.length)) throw new Error('Ten wpływ nie jest skonfigurowany w Ustawieniach (sekcja WPŁYWY).');
    sign = inflow ? inflow.sign : 1;
  } else if (blk.id === 'netto') {
    throw new Error('Wpływy dodawaj przełącznikiem „Wpływ”.');
  }
  if (amount < 0 && isIncome) throw new Error('Kwota wpływu musi być większa od zera.');

  const cell = sheet.getRange(blk.hr + 2 + tMonth, blk.cols[ci].c + 1);
  const a1 = cell.getA1Notation();
  const oldF = cell.getFormula();
  const oldV = cell.getValue();
  if (oldF && typeof oldV !== 'number') throw new Error('Formuła w komórce ' + a1 + ' nie daje liczby. Popraw ją w arkuszu.');
  const isText = !oldF && typeof oldV === 'string' && !isEmpty_(oldV);
  if (isText && CFG.IGNORED_TEXT.indexOf(norm_(oldV)) < 0) {
    throw new Error('W komórce ' + a1 + ' jest tekst „' + String(oldV).trim() + '”. Zamień go w arkuszu na kwotę albo usuń i spróbuj ponownie.');
  }
  const before = oldF || (isEmpty_(oldV) ? '' : oldV);
  const delta = sign * amount;
  const expected = Math.round(((typeof oldV === 'number' ? oldV : 0) + delta) * 100) / 100;

  if (!oldF && typeof oldV !== 'number') {
    cell.setValue(delta);                        // pusta komórka (albo „brak”)
  } else if (delta === 0) {
    // płatność w całości z nadpłaty: komórka już ma wartość – zostawiamy ją bez zmian
  } else {
    let done = false;
    const seps = decimalSeps_(ss, oldF);
    for (let i = 0; i < seps.length && !done; i++) {
      const head = oldF || ('=' + numStr_(oldV, seps[i]));
      const f = head + (delta < 0 ? '-' : '+') + numStr_(Math.abs(delta), seps[i]);
      cell.setFormula(f);
      SpreadsheetApp.flush();
      const got = cell.getValue();
      done = typeof got === 'number' && Math.abs(got - expected) < 0.005;
    }
    if (!done) cell.setValue(expected);          // awaryjnie: sama suma, bez rozbicia
  }
  const after = cell.getFormula() || cell.getValue();

  if (p.unpaid && !isIncome) {
    const add = unpaidNote_(amount, desc);
    const old = cell.getNote();
    cell.setNote(old ? old + '\n' + add : add);
  }

  const log = ensureLogSheet_(ss);
  const id = 'W' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const category = blk.name + ' / ' + blk.cols[ci].name;
  log.appendRow([id, new Date(), date, isIncome ? 'wpływ' : 'wydatek', category, amount, asText_(desc),
    p.unpaid ? 'TAK' : '', sheet.getName() + '!' + a1, asText_(before), asText_(after), 'dodany',
    creditUsed || '', payment ? asText_(payment.name) : '']);
  if (creditUsed) {
    const left = Math.round((payment.credit - creditUsed) * 100) / 100;
    ss.getSheetByName(CFG.SETTINGS_SHEET).getRange(payment.row, 8).setValue(left > 0 ? left : '');
  }

  return { id: id, category: category, amount: amount, creditUsed: creditUsed, kind: isIncome ? 'wpływ' : 'wydatek', date: dateStr_(date), cell: a1, month: CFG.MONTH_NAME[tMonth] };
}

function undoEntry_(ss, id) {
  const log = ss.getSheetByName(CFG.LOG_SHEET);
  if (!log) throw new Error('Nie ma zakładki „' + CFG.LOG_SHEET + '”.');
  const v = log.getDataRange().getValues();
  let r = -1;
  for (let i = v.length - 1; i >= 1; i--) { if (String(v[i][0]) === String(id)) { r = i; break; } }
  if (r < 0) throw new Error('Nie znalazłem tego wpisu w dzienniku.');
  const row = v[r];
  if (/cofni/i.test(String(row[11]))) throw new Error('Ten wpis jest już cofnięty.');
  const ref = String(row[8]);
  const k = ref.lastIndexOf('!');
  const sheet = ss.getSheetByName(ref.slice(0, k));
  if (!sheet) throw new Error('Nie ma już zakładki „' + ref.slice(0, k) + '”.');
  const cell = sheet.getRange(ref.slice(k + 1));
  const before = row[9], after = row[10];
  const curF = cell.getFormula(), curV = cell.getValue();
  const same = typeof after === 'number'
    ? (!curF && typeof curV === 'number' && Math.abs(curV - after) < 0.005)
    : (!!curF && normF_(curF) === normF_(after));
  if (!same) throw new Error('Komórka ' + ref.slice(k + 1) + ' zmieniła się od czasu tego wpisu. Popraw ją ręcznie w arkuszu.');

  if (String(before).charAt(0) === '=') cell.setFormula(String(before));
  else if (isEmpty_(before)) cell.clearContent();
  else cell.setValue(before);

  if (/^TAK$/i.test(String(row[7] || '').trim())) {
    const text = unpaidNote_(toNum_(row[5]) || 0, String(row[6] || ''));
    const lines = String(cell.getNote() || '').split('\n');
    const at = lines.lastIndexOf(text);
    if (at >= 0) { lines.splice(at, 1); cell.setNote(lines.join('\n')); }
  }
  log.getRange(r + 1, 12).setValue('cofnięty');
  const used = toNum_(row[12]);
  if (used && row[13]) {
    const sh = ss.getSheetByName(CFG.SETTINGS_SHEET);
    const pay = parseSettings_(sh.getDataRange().getValues()).payments.filter(function (x) { return x.name === String(row[13]); })[0];
    if (pay) sh.getRange(pay.row, 8).setValue(Math.round((pay.credit + used) * 100) / 100);
  }
}

/* ============================ DIAGNOSTYKA ============================ */

/** Podgląd modelu w logach (Wykonaj → Dziennik wykonania). */
function debugModel() {
  Logger.log(JSON.stringify(getDashboardData(), null, 2));
}
