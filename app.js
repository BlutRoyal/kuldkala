(() => {
  'use strict';

  const CFG = window.KULDKALA_CONFIG || {};
  const DEMO = !CFG.API_URL || !CFG.GOOGLE_CLIENT_ID;
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privaatne aken */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  };

  let tasks = store.get('kk_tasks') || [];
  let filter = store.get('kk_filter') || 'all';
  let token = null;
  let editing = null;
  let touched = {};

  // ---------- kuupäevad ----------
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());
  const WD = ['P', 'E', 'T', 'K', 'N', 'R', 'L'];
  function fmtDue(t) {
    if (!t.due) return '';
    const d = new Date(t.due + 'T00:00:00');
    const diff = Math.round((d - new Date(today() + 'T00:00:00')) / 864e5);
    let s = diff === 0 ? 'täna' : diff === 1 ? 'homme' : diff === -1 ? 'eile'
      : `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
    if (t.time) s += ' ' + t.time;
    return s;
  }

  // ---------- sisselogimine ----------
  function jwtExp(tok) {
    try { return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
    catch { return 0; }
  }
  function tokenValid(tok) { return tok && jwtExp(tok) - Date.now() > 60e3; }

  function onCredential(resp) {
    token = resp.credential;
    store.set('kk_token', token);
    showMain();
    load();
  }

  function initGoogle() {
    if (!window.google || !google.accounts) { setTimeout(initGoogle, 200); return; }
    google.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
    });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_black', size: 'large', shape: 'pill', locale: 'et' });
    if (!tokenValid(token)) google.accounts.id.prompt();
  }

  function showLogin(msg) {
    $('#main').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-msg').textContent = msg || '';
  }
  function showMain() {
    $('#login').classList.add('hidden');
    $('#main').classList.remove('hidden');
  }

  // ---------- server ----------
  async function api(action, data) {
    if (DEMO) return demoApi(action, data);
    if (!tokenValid(token)) { reauth(); throw new Error('auth'); }
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain väldib CORS preflight'i, mida Apps Script ei toeta
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, data }),
      redirect: 'follow',
    });
    const out = await res.json();
    if (!out.ok) {
      if (out.error === 'auth') { reauth(); }
      if (out.error === 'forbidden') { store.del('kk_token'); token = null; showLogin('Sellel kontol pole ligipääsu.'); }
      throw new Error(out.error);
    }
    return out.data;
  }

  function reauth() {
    token = null;
    store.del('kk_token');
    if (window.google && google.accounts) google.accounts.id.prompt();
    syncMsg('Logi uuesti sisse…');
  }

  function demoApi(action, data) {
    const now = new Date().toISOString();
    const find = () => tasks.find((t) => t.id === data.id);
    switch (action) {
      case 'list': return Promise.resolve(tasks);
      case 'add': return Promise.resolve({ ...data, id: crypto.randomUUID(), status: 'open', createdAt: now, updatedAt: now });
      case 'update': return Promise.resolve({ ...find(), ...data, updatedAt: now });
      case 'done': return Promise.resolve({ ...find(), status: 'done', doneAt: now });
      case 'reopen': return Promise.resolve({ ...find(), status: 'open', doneAt: '' });
      case 'delete': return Promise.resolve({ id: data.id });
    }
  }

  function syncMsg(text) {
    const el = $('#sync-msg');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  function save() { store.set('kk_tasks', tasks); render(); }

  async function load() {
    try {
      tasks = await api('list', {});
      syncMsg('');
      save();
    } catch (e) {
      if (e.message !== 'auth' && e.message !== 'forbidden') syncMsg('Ei saanud serveriga ühendust. Näitan viimast salvestatud seisu.');
    }
  }

  async function mutate(action, data, optimistic) {
    const before = tasks.slice();
    if (optimistic) { optimistic(); save(); }
    try {
      const res = await api(action, data);
      if (action === 'delete') tasks = tasks.filter((t) => t.id !== data.id);
      else if (action === 'add') tasks = tasks.filter((t) => t.id !== data._tmp).concat(res);
      else tasks = tasks.map((t) => (t.id === res.id ? res : t));
      syncMsg('');
      save();
    } catch (e) {
      tasks = before;
      save();
      if (e.message !== 'auth') syncMsg('Salvestamine ebaõnnestus. Proovi uuesti.');
    }
  }

  // ---------- kuvamine ----------
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sortKey(t) { return (t.due || '9999-99-99') + (t.time || '99:99') + t.title.toLowerCase(); }

  function groups() {
    const td = today();
    const vis = tasks.filter((t) => filter === 'all' || t.tag === filter);
    const open = vis.filter((t) => t.status !== 'done').sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const g = [
      { key: 'overdue', title: 'Tähtaeg möödas', items: open.filter((t) => !t.list && t.due && t.due < td) },
      { key: 'today', title: 'Täna', items: open.filter((t) => !t.list && t.due === td) },
      { key: 'soon', title: 'Tulemas', items: open.filter((t) => !t.list && t.due && t.due > td) },
      { key: 'nodate', title: 'Ilma tähtajata', items: open.filter((t) => !t.list && !t.due) },
      { key: 'waiting', title: 'Ootan teiste taga', items: open.filter((t) => t.list === 'ootan') },
      { key: 'someday', title: 'Kunagi', items: open.filter((t) => t.list === 'kunagi'), collapsed: true },
      {
        key: 'done', title: 'Tehtud', collapsed: true,
        items: vis.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
      },
    ];
    return g;
  }

  function taskHtml(t) {
    const done = t.status === 'done';
    const late = !done && t.due && t.due < today();
    return `<div class="task${done ? ' done' : ''}" data-id="${esc(t.id)}">
      <button class="check" data-act="${done ? 'reopen' : 'done'}" aria-label="${done ? 'Ava uuesti' : 'Tehtud'}">${done ? '✓' : ''}</button>
      <div class="t-body" data-act="edit">
        <div class="t-title">${esc(t.title)}</div>
        ${t.firstStep && !done ? `<div class="t-step">→ ${esc(t.firstStep)}</div>` : ''}
        <div class="t-meta">
          ${filter === 'all' ? `<span class="pill ${esc(t.tag)}">${esc(t.tag)}</span>` : ''}
          ${t.due ? `<span class="${late ? 'late' : ''}">📅 ${esc(fmtDue(t))}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function render() {
    document.querySelectorAll('.filters button').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
    const gs = groups();
    const html = gs.filter((g) => g.items.length).map((g) => {
      const body = g.items.map(taskHtml).join('');
      return g.collapsed
        ? `<details class="group ${g.key}"><summary>${g.title} (${g.items.length})</summary>${body}</details>`
        : `<section class="group ${g.key}"><h3>${g.title} (${g.items.length})</h3>${body}</section>`;
    }).join('');
    $('#list').innerHTML = html || '<p class="empty">Kõik tehtud! 🎉</p>';

    const d = new Date();
    const ds = d.toLocaleDateString('et-EE', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#today-date').textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
    const n = (k) => gs.find((g) => g.key === k).items.length;
    const parts = [];
    if (n('overdue')) parts.push(`<span class="late">${n('overdue')} tähtaeg möödas</span>`);
    parts.push(`${n('today')} täna`);
    $('#today-summary').innerHTML = parts.join(' · ');
  }

  // ---------- ilm (Open-Meteo, võtit pole vaja) ----------
  const WMO = {
    0: '☀️ selge', 1: '🌤️ peamiselt selge', 2: '⛅ vahelduv pilvisus', 3: '☁️ pilves',
    45: '🌫️ udu', 48: '🌫️ udu', 51: '🌦️ uduvihm', 53: '🌦️ uduvihm', 55: '🌦️ uduvihm',
    56: '🌧️ jäine uduvihm', 57: '🌧️ jäine uduvihm', 61: '🌧️ nõrk vihm', 63: '🌧️ vihm', 65: '🌧️ tugev vihm',
    66: '🌧️ jäävihm', 67: '🌧️ jäävihm', 71: '🌨️ nõrk lumi', 73: '🌨️ lumi', 75: '❄️ tugev lumi', 77: '🌨️ lumeterad',
    80: '🌦️ hoovihm', 81: '🌧️ hoovihm', 82: '⛈️ tugev hoovihm', 85: '🌨️ lumehood', 86: '❄️ tugevad lumehood',
    95: '⛈️ äike', 96: '⛈️ äike rahega', 99: '⛈️ äike rahega',
  };
  async function loadWeather() {
    const w = CFG.WEATHER || { name: 'Tallinn', lat: 59.437, lon: 24.7536 };
    const cached = store.get('kk_weather');
    if (cached && cached.day === today() && Date.now() - cached.at < 3 * 3600e3) { showWeather(cached.data, w.name); return; }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}` +
        '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,' +
        'precipitation_probability_max,wind_speed_10m_max&wind_speed_unit=ms&timezone=Europe%2FTallinn&forecast_days=1';
      const data = await (await fetch(url)).json();
      store.set('kk_weather', { day: today(), at: Date.now(), data });
      showWeather(data, w.name);
    } catch {
      $('#weather').textContent = 'Ilma ei saanud laadida.';
    }
  }
  function showWeather(d, name) {
    const dl = d.daily;
    const r = (x) => Math.round(x);
    $('#weather').textContent = `${name}: ${WMO[dl.weather_code[0]] || ''}, ${r(dl.temperature_2m_min[0])}…${r(dl.temperature_2m_max[0])}°` +
      ` (praegu ${r(d.current.temperature_2m)}°), sademed ${dl.precipitation_probability_max[0] ?? 0}%, tuul kuni ${r(dl.wind_speed_10m_max[0])} m/s`;
  }

  // ---------- muutmise aken ----------
  const form = $('#task-form');
  function setSeg(id, v) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  }
  function segVal(id) { const b = document.querySelector(`#${id} button.active`); return b ? b.dataset.v : ''; }

  function openEditor(t) {
    editing = t || null;
    $('#editor-title').textContent = t ? 'Muuda' : 'Uus asi';
    form.title.value = t ? t.title : '';
    form.due.value = t ? t.due : '';
    form.time.value = t ? t.time : '';
    form.firstStep.value = t ? t.firstStep : '';
    form.notes.value = t ? t.notes : '';
    setSeg('tag-seg', t ? t.tag : (filter === 'all' ? 'Era' : filter));
    setSeg('list-seg', t ? t.list : '');
    $('#delete').classList.toggle('hidden', !t);
    touched = {};
    $('#parse-hint').textContent = '';
    $('#editor').showModal();
    if (!t) form.title.focus();
  }

  // vaba tekst: "homme kell 15 helista Peetrile #töö" täidab kuupäeva, kella ja sildi
  function parseTitle() {
    if (editing || !window.kkParse) return null;
    const r = window.kkParse(form.title.value);
    return r.title && (r.due || r.time || r.tag) ? r : null;
  }
  form.title.addEventListener('input', () => {
    const r = parseTitle();
    if (!editing) {
      if (!touched.due) form.due.value = r ? r.due : '';
      if (!touched.time) form.time.value = r ? r.time : '';
      if (!touched.tag && r && r.tag) setSeg('tag-seg', r.tag);
    }
    $('#parse-hint').textContent = r ? `✨ Pealkiri: ${r.title}` : '';
  });
  form.due.addEventListener('input', () => { touched.due = true; });
  form.time.addEventListener('input', () => { touched.time = true; });
  $('#tag-seg').addEventListener('click', () => { touched.tag = true; });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      title: form.title.value.trim(), tag: segVal('tag-seg'), list: segVal('list-seg'),
      due: form.due.value, time: form.time.value, firstStep: form.firstStep.value.trim(), notes: form.notes.value.trim(),
    };
    const parsed = parseTitle();
    if (parsed) data.title = parsed.title;
    if (!data.title) return;
    $('#editor').close();
    if (editing) {
      const id = editing.id;
      mutate('update', { id, ...data }, () => { tasks = tasks.map((t) => (t.id === id ? { ...t, ...data } : t)); });
    } else {
      const tmp = 'tmp-' + Date.now();
      mutate('add', { ...data, _tmp: tmp }, () => { tasks = tasks.concat({ ...data, id: tmp, status: 'open' }); });
    }
  });
  $('#cancel').addEventListener('click', () => $('#editor').close());
  $('#delete').addEventListener('click', () => {
    if (!editing || !confirm('Kustutan selle asja?')) return;
    const id = editing.id;
    $('#editor').close();
    mutate('delete', { id }, () => { tasks = tasks.filter((t) => t.id !== id); });
  });
  ['tag-seg', 'list-seg'].forEach((id) => $('#' + id).addEventListener('click', (e) => {
    if (e.target.dataset.v !== undefined) setSeg(id, e.target.dataset.v);
  }));

  // ---------- sündmused ----------
  $('#list').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.closest('.task').dataset.id;
    const t = tasks.find((x) => x.id === id);
    if (!t || id.startsWith('tmp-')) return;
    const act = el.dataset.act;
    if (act === 'edit') openEditor(t);
    else if (act === 'done' || act === 'reopen') {
      const patch = act === 'done' ? { status: 'done', doneAt: new Date().toISOString() } : { status: 'open', doneAt: '' };
      mutate(act, { id }, () => { tasks = tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)); });
    }
  });
  document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter; store.set('kk_filter', filter); render();
  }));
  $('#add').addEventListener('click', () => openEditor(null));
  $('#refresh').addEventListener('click', () => { load(); loadWeather(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); loadWeather(); } });

  // ---------- käivitus ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  loadWeather();
  if (DEMO) {
    showMain();
    syncMsg('Demorežiim: server pole veel seadistatud, andmed on ainult selles brauseris.');
  } else {
    token = store.get('kk_token');
    if (tokenValid(token)) { showMain(); load(); } else showLogin();
    initGoogle();
  }
})();
