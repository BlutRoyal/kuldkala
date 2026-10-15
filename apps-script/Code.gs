/**
 * Kuldkala server (Google Apps Script, seotud Google Sheetiga).
 *
 * Salajased seaded on Script Properties all (mitte koodis):
 *   CLIENT_ID      – Google OAuth Client ID (sama mis äpi config.js-is)
 *   ALLOWED_EMAILS – komadega eraldatud e-postid, kes tohivad sisse logida
 */

const SHEET = 'tasks';
const COLS = ['id', 'user', 'title', 'tag', 'list', 'due', 'time', 'firstStep',
  'notes', 'status', 'doneAt', 'createdAt', 'updatedAt', 'repeat', 'remind'];
const EDITABLE = ['title', 'tag', 'list', 'due', 'time', 'firstStep', 'notes', 'repeat', 'remind'];
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
}

function doGet() {
  return ContentService.createTextOutput('kuldkala');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const user = auth_(req.token);
    out = { ok: true, data: handle_(user, String(req.action || ''), req.data || {}) };
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
  found.task.status = status;
  found.task.doneAt = status === 'done' ? new Date().toISOString() : '';
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
  EDITABLE.forEach(function (k) {
    if (data[k] === undefined) return;
    let v = String(data[k] == null ? '' : data[k]).trim().slice(0, k === 'notes' ? 2000 : 300);
    if (k === 'tag' && TAGS.indexOf(v) < 0) v = 'Era';
    if (k === 'list' && LISTS.indexOf(v) < 0) v = '';
    if (k === 'due' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('bad date');
    if (k === 'time' && v && !/^\d{2}:\d{2}$/.test(v)) throw new Error('bad time');
    t[k] = v;
  });
  if (!t.tag) t.tag = 'Era';
}

function publicTask_(t) {
  const o = {};
  COLS.forEach(function (c) { if (c !== 'user') o[c] = t[c] == null ? '' : t[c]; });
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
