/**
 * Kuldkala server (Google Apps Script, seotud Google Sheetiga).
 *
 * Salajased seaded on Script Properties all (mitte koodis):
 *   CLIENT_ID      – Google OAuth Client ID (sama mis äpi config.js-is)
 *   ALLOWED_EMAILS – komadega eraldatud e-postid, kes tohivad sisse logida
 *   FCM_KEY        – Firebase'i service account JSON (teadete saatmiseks)
 *
 * Pärast koodi uuendamist käivita üks kord setup() ja installTriggers().
 */

const SHEET = 'tasks';
const COLS = ['id', 'user', 'title', 'tag', 'list', 'due', 'time', 'firstStep',
  'notes', 'status', 'doneAt', 'createdAt', 'updatedAt', 'repeat', 'remind', 'log'];
const EDITABLE = ['title', 'tag', 'list', 'due', 'time', 'firstStep', 'notes', 'repeat'];
const DEV_SHEET = 'devices';
const DEV_COLS = ['user', 'fcmToken', 'secretHash', 'ua', 'createdAt'];
const TZ = 'Europe/Tallinn';
const NAG_HOURS = 2;          // kinnitamata asja kordusmeeldetuletus
const NAG_WINDOW_HOURS = 24;  // kui kaua pärast tähtaega meelde tuletatakse
const MORNING = '09:00';      // hommikune plaan
const TAGS = ['Töö', 'Era'];
const LISTS = ['', 'ootan', 'kunagi'];
const DONE_VISIBLE_DAYS = 14;

/** Käivita üks kord Apps Scripti redaktorist: loob lehe ja päise. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) sh = ss.insertSheet(SHEET);
  sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  let dev = ss.getSheetByName(DEV_SHEET);
  if (!dev) dev = ss.insertSheet(DEV_SHEET);
  dev.getRange(1, 1, dev.getMaxRows(), DEV_COLS.length).setNumberFormat('@');
  dev.getRange(1, 1, 1, DEV_COLS.length).setValues([DEV_COLS]).setFontWeight('bold');
  dev.setFrozenRows(1);
}

/** Käivita üks kord: paneb tick() käima iga 5 minuti tagant. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
}

function doGet() {
  return ContentService.createTextOutput('kuldkala');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.device) {
      // teate nupud: seade tõendab end oma salajase võtmega, lubatud ainult done/snooze
      const user = authDevice_(req.device);
      const action = String(req.action || '');
      if (action !== 'done' && action !== 'snooze') throw new Error('forbidden');
      out = { ok: true, data: handle_(user, action, req.data || {}) };
    } else {
      const user = auth_(req.token);
      out = { ok: true, data: handle_(user, String(req.action || ''), req.data || {}) };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- autentimine ----------

function auth_(token) {
  if (!token || typeof token !== 'string') throw new Error('auth');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' +
    encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('auth');
  const info = JSON.parse(res.getContentText());

  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('CLIENT_ID');
  if (!clientId || info.aud !== clientId) throw new Error('auth');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') throw new Error('auth');
  if (String(info.email_verified) !== 'true') throw new Error('auth');
  const now = Math.floor(Date.now() / 1000);
  if (Number(info.exp) <= now) throw new Error('auth');

  const email = String(info.email).toLowerCase();
  const allowed = (props.getProperty('ALLOWED_EMAILS') || '').toLowerCase()
    .split(',').map(function (s) { return s.trim(); }).filter(String);
  if (allowed.indexOf(email) < 0) throw new Error('forbidden');

  const ttl = Math.min(600, Number(info.exp) - now);
  if (ttl > 30) cache.put(key, email, ttl);
  return email;
}

// ---------- tegevused ----------

function handle_(user, action, data) {
  switch (action) {
    case 'list': return listTasks_(user);
    case 'add': return withLock_(function () { return addTask_(user, data); });
    case 'update': return withLock_(function () { return updateTask_(user, data); });
    case 'done': return withLock_(function () { return setStatus_(user, data.id, 'done'); });
    case 'reopen': return withLock_(function () { return setStatus_(user, data.id, 'open'); });
    case 'delete': return withLock_(function () { return deleteTask_(user, data.id); });
    case 'addLog': return withLock_(function () { return addLog_(user, data); });
    case 'snooze': return withLock_(function () { return snooze_(user, data.id, data.minutes); });
    case 'registerPush': return withLock_(function () { return registerDevice_(user, data); });
    default: throw new Error('unknown action');
  }
}

function listTasks_(user) {
  const cutoff = Date.now() - DONE_VISIBLE_DAYS * 864e5;
  return readRows_().filter(function (t) {
    if (t.user !== user) return false;
    if (t.status !== 'done') return true;
    return t.doneAt && Date.parse(t.doneAt) >= cutoff;
  }).map(publicTask_);
}

function addTask_(user, data) {
  const now = new Date().toISOString();
  const t = { id: Utilities.getUuid(), user: user, status: 'open', doneAt: '', createdAt: now, updatedAt: now };
  applyEdits_(t, data);
  if (!t.title) throw new Error('title required');
  sheet_().appendRow(COLS.map(function (c) { return t[c] == null ? '' : String(t[c]); }));
  return publicTask_(t);
}

function updateTask_(user, data) {
  const found = findRow_(user, data.id);
  applyEdits_(found.task, data);
  if (!found.task.title) throw new Error('title required');
  found.task.updatedAt = new Date().toISOString();
  writeRow_(found.row, found.task);
  return publicTask_(found.task);
}

function setStatus_(user, id, status) {
  const found = findRow_(user, id);
  const next = status === 'done' && found.task.repeat ? nextDue_(found.task) : '';
  if (next) {
    // korduv asi: liigub järgmisele kuupäevale ja jääb avatuks
    found.task.due = next;
    found.task.status = 'open';
    found.task.doneAt = new Date().toISOString();
    found.task.remind = '';
    found.task.updatedAt = new Date().toISOString();
    writeRow_(found.row, found.task);
    return publicTask_(found.task);
  }
  found.task.status = status;
  found.task.doneAt = status === 'done' ? new Date().toISOString() : '';
  found.task.remind = '';
  found.task.updatedAt = new Date().toISOString();
  writeRow_(found.row, found.task);
  return publicTask_(found.task);
}

function deleteTask_(user, id) {
  const found = findRow_(user, id);
  sheet_().deleteRow(found.row);
  return { id: id };
}

// ---------- abifunktsioonid ----------

function applyEdits_(t, data) {
  const before = (t.due || '') + ' ' + (t.time || '');
  EDITABLE.forEach(function (k) {
    if (data[k] === undefined) return;
    let v = String(data[k] == null ? '' : data[k]).trim().slice(0, k === 'notes' ? 2000 : 300);
    if (k === 'tag' && TAGS.indexOf(v) < 0) v = 'Era';
    if (k === 'list' && LISTS.indexOf(v) < 0) v = '';
    if (k === 'due' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('bad date');
    if (k === 'time' && v && !/^\d{2}:\d{2}$/.test(v)) throw new Error('bad time');
    if (k === 'repeat' && v && !/^(day|week|month:\d{1,2}|lastwork|year)$/.test(v)) v = '';
    t[k] = v;
  });
  if (!t.tag) t.tag = 'Era';
  if ((t.due || '') + ' ' + (t.time || '') !== before) t.remind = '';
}

function publicTask_(t) {
  const o = {};
  COLS.forEach(function (c) { if (c !== 'user' && c !== 'remind') o[c] = t[c] == null ? '' : t[c]; });
  return o;
}

function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  if (!sh) throw new Error('run setup()');
  return sh;
}

function readRows_() {
  const values = sheet_().getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  return values.slice(1).map(function (r) {
    const t = {};
    COLS.forEach(function (c, i) {
      let v = r[i];
      if (v instanceof Date) {
        v = c === 'time' ? Utilities.formatDate(v, tz, 'HH:mm')
          : c === 'due' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
            : v.toISOString();
      }
      t[c] = String(v == null ? '' : v);
    });
    t.user = t.user.toLowerCase();
    return t;
  });
}

function findRow_(user, id) {
  if (!id) throw new Error('id required');
  const rows = readRows_();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id && rows[i].user === user) return { row: i + 2, task: rows[i] };
  }
  throw new Error('not found');
}

function writeRow_(row, t) {
  sheet_().getRange(row, 1, 1, COLS.length)
    .setValues([COLS.map(function (c) { return t[c] == null ? '' : String(t[c]); })]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- korduvad asjad ----------

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function dateOf_(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
function lastDay_(y, m) { return new Date(y, m + 1, 0, 12).getDate(); }
function backToFriday_(d) {
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

/** Järgmine tähtaeg: hilisem nii tänasest kui praegusest tähtajast. */
function nextDue_(t) {
  const today = ymd_(new Date());
  const cur = t.due || today;
  const base = dateOf_(cur);
  const rep = t.repeat;
  const ok = function (d) { const s = ymd_(d); return s > today && s > cur ? s : ''; };
  if (rep === 'month' || /^month:/.test(rep) || rep === 'lastwork') {
    // kuu kaupa; laupäev/pühapäev → eelnev reede
    const anchor = Number(rep.split(':')[1]) || base.getDate();
    for (let k = 1; k < 40; k++) {
      const y = base.getFullYear(), m = base.getMonth() + k;
      const ld = lastDay_(y, m);
      const r = ok(backToFriday_(new Date(y, m, rep === 'lastwork' ? ld : Math.min(anchor, ld), 12)));
      if (r) return r;
    }
    return '';
  }
  const d = new Date(base);
  for (let i = 0; i < 1000; i++) {
    if (rep === 'day') d.setDate(d.getDate() + 1);
    else if (rep === 'week') d.setDate(d.getDate() + 7);
    else if (rep === 'year') d.setFullYear(d.getFullYear() + 1);
    else return '';
    const r = ok(d);
    if (r) return r;
  }
  return '';
}

// ---------- seadmed ja teated ----------

function devSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DEV_SHEET);
  if (!sh) throw new Error('run setup()');
  return sh;
}

function sha_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
}

function registerDevice_(user, data) {
  const token = String(data.token || '');
  if (!token || token.length > 4096) throw new Error('bad token');
  const secret = Utilities.getUuid() + Utilities.getUuid();
  const sh = devSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][1] === token) sh.deleteRow(i + 1);
  }
  sh.appendRow([user, token, sha_(secret), String(data.ua || '').slice(0, 120), new Date().toISOString()]);
  return { secret: secret };
}

function authDevice_(secret) {
  if (!secret || typeof secret !== 'string') throw new Error('auth');
  const h = sha_(secret);
  const rows = devSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (rows[i][2] === h) return String(rows[i][0]).toLowerCase();
  throw new Error('auth');
}

/** Jätk: "minu osa tehtud, ootan vastust". Uusim rida on eespool. */
function addLog_(user, data) {
  const found = findRow_(user, data.id);
  const text = String(data.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) throw new Error('text required');
  const t = found.task;
  t.log = (ymd_(new Date()) + '|' + text + (t.log ? '\n' + t.log : '')).slice(0, 5000);
  if (data.wait) {
    t.list = 'ootan';
    if (data.due !== undefined) {
      const due = String(data.due || '');
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('bad date');
      t.due = due;
      t.time = '';
      t.remind = '';
    }
  }
  t.updatedAt = new Date().toISOString();
  writeRow_(found.row, t);
  return publicTask_(t);
}

function snooze_(user, id, minutes) {
  const found = findRow_(user, id);
  const m = Math.max(5, Math.min(24 * 60, Number(minutes) || 60));
  found.task.remind = new Date(Date.now() + m * 60e3).toISOString();
  writeRow_(found.row, found.task);
  return publicTask_(found.task);
}

/** Iga 5 minuti tagant: tähtajaga asjade teated ja hommikune plaan. */
function tick() {
  const now = new Date();
  const hm = Utilities.formatDate(now, TZ, 'HH:mm');
  const props = PropertiesService.getScriptProperties();
  const today = ymd_(now);
  if (hm >= MORNING && props.getProperty('MORNING_SENT') !== today) {
    props.setProperty('MORNING_SENT', today);
    morning_();
  }
  if (hm < '08:00' || hm >= '22:00') return;  // öösel ei sega
  withLock_(function () {
    const rows = readRows_();
    rows.forEach(function (t, i) {
      if (t.status === 'done' || !t.due || !t.time || t.remind === 'off') return;
      const dueAt = Utilities.parseDate(t.due + ' ' + t.time, TZ, 'yyyy-MM-dd HH:mm');
      const at = t.remind ? new Date(t.remind) : dueAt;
      if (at > now || now - at > 6 * 3600e3) return;
      notifyUser_(t.user, {
        kind: 'task', taskId: t.id, title: t.title,
        body: t.firstStep ? 'Esimene samm: ' + t.firstStep : (t.due === today ? 'Täna kell ' + t.time : 'Tähtaeg oli ' + t.due.slice(8) + '.' + t.due.slice(5, 7) + ' ' + t.time),
      });
      const next = new Date(now.getTime() + NAG_HOURS * 3600e3);
      t.remind = next - dueAt < NAG_WINDOW_HOURS * 3600e3 ? next.toISOString() : 'off';
      writeRow_(i + 2, t);
    });
  });
}

function morning_() {
  const users = {};
  devSheet_().getDataRange().getValues().slice(1).forEach(function (r) { users[String(r[0]).toLowerCase()] = 1; });
  const today = ymd_(new Date());
  const rows = readRows_();
  const weather = weatherLine_();
  Object.keys(users).forEach(function (u) {
    const open = rows.filter(function (t) { return t.user === u && t.status !== 'done' && !t.list; });
    const over = open.filter(function (t) { return t.due && t.due < today; }).length;
    const tod = open.filter(function (t) { return t.due === today; });
    const parts = [];
    if (over) parts.push(over + ' üle tähtaja');
    parts.push(tod.length + ' täna');
    const first = tod.concat(open.filter(function (t) { return t.due && t.due < today; }))[0];
    notifyUser_(u, {
      kind: 'morning', title: '☀️ Tänane plaan',
      body: parts.join(', ') + (weather ? ' · ' + weather : '') + (first ? '\nEsimesena: ' + first.title : ''),
    });
  });
}

function weatherLine_() {
  try {
    const d = JSON.parse(UrlFetchApp.fetch('https://api.open-meteo.com/v1/forecast?latitude=59.437&longitude=24.7536' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FTallinn&forecast_days=1').getContentText()).daily;
    return Math.round(d.temperature_2m_min[0]) + '…' + Math.round(d.temperature_2m_max[0]) + '°, sademed ' + d.precipitation_probability_max[0] + '%';
  } catch (e) { return ''; }
}

function notifyUser_(user, data) {
  const sh = devSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).toLowerCase() !== user) continue;
    const res = fcmSend_(rows[i][1], data);
    if (res === 'gone') sh.deleteRow(i + 1);
  }
}

function fcmSend_(token, data) {
  const key = JSON.parse(PropertiesService.getScriptProperties().getProperty('FCM_KEY') || '{}');
  if (!key.project_id) throw new Error('FCM_KEY missing');
  const payload = {};
  Object.keys(data).forEach(function (k) { payload[k] = String(data[k]); });
  const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + key.project_id + '/messages:send', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + fcmAccess_(key) },
    payload: JSON.stringify({ message: { token: token, data: payload, webpush: { headers: { Urgency: 'high', TTL: '21600' } } } }),
  });
  const code = res.getResponseCode();
  if (code === 404 || (code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText()))) return 'gone';
  if (code !== 200) console.error('FCM ' + code + ': ' + res.getContentText());
  return code;
}

function fcmAccess_(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_at');
  if (hit) return hit;
  const b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: iat, exp: iat + 3600,
  }));
  const jwt = unsigned + '.' + b64(Utilities.computeRsaSha256Signature(unsigned, key.private_key));
  const res = JSON.parse(UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
  }).getContentText());
  cache.put('fcm_at', res.access_token, 3000);
  return res.access_token;
}

/** Proovi teadet: käivita redaktorist, saadab sulle testteate. */
function testPush() {
  const email = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '').split(',')[0].trim().toLowerCase();
  notifyUser_(email, { kind: 'test', title: '🐟 Kuldkala', body: 'Teated töötavad!' });
}
