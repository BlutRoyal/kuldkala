// Vabas vormis eestikeelse teksti lugemine: leiab kuupäeva, kellaaja ja sildi.
// Näide: "homme kell 15 helista Peetrile #töö" → { title: "helista Peetrile", due: homne, time: "15:00", tag: "Töö" }
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // \b ei tööta täpitähtedega (ü, ä, õ), seega omad piirid
  const B = '(?<![\\p{L}\\d])';
  const E = '(?![\\p{L}\\d])';
  const R = (src) => new RegExp(B + src + E, 'u');

  // getDay(): 0 = pühapäev
  const WEEKDAYS = ['pühapäev', 'esmaspäev', 'teisipäev', 'kolmapäev', 'neljapäev', 'reede', 'laupäev'];
  const WD_RE = R('(järgmisel\\s+)?(' + WEEKDAYS.join('|') + ')(?:al|a|aks|l|ks)?');
  const MONTHS = ['jaan', 'veebr', 'märts', 'apr', 'mai', 'juuni', 'juuli', 'aug', 'sept', 'okt', 'nov', 'dets'];
  const PARTS = [[R('hommikul'), '09:00'], [R('lõunal'), '12:00'], [R('pärastlõunal'), '15:00'], [R('õhtul'), '18:00']];

  function parse(text, now) {
    now = now || new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let s = ' ' + String(text || '') + ' ';
    let due = '';
    let time = '';
    let tag = '';
    const low = () => s.toLowerCase();
    const cut = (m) => { s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); };
    const find = (re) => { const m = re.exec(low()); if (m) cut(m); return m; };
    let m;

    // silt
    if ((m = find(/(^|\s)#(töö|too|era)(?![\p{L}\d])/u))) tag = m[2] === 'era' ? 'Era' : 'Töö';

    // kellaaeg: "kell 15", "kl 9.30", "15:30"
    if ((m = find(R('(?:kell|kl\\.?)\\s*(\\d{1,2})(?:[:.](\\d{2}))?'))) || (m = find(R('(\\d{1,2}):(\\d{2})')))) {
      const h = +m[1], mi = +(m[2] || 0);
      if (h < 24 && mi < 60) time = `${pad(h)}:${pad(mi)}`;
    }

    // kuupäev
    if ((m = find(R('ülehomme')))) due = iso(addDays(today, 2));
    else if ((m = find(R('homme')))) due = iso(addDays(today, 1));
    else if ((m = find(R('täna')))) due = iso(today);
    else if ((m = find(R('(\\d+|ühe|kahe|kolme|nelja|viie)\\s+(päeva|nädala)\\s+pärast')))) {
      const words = { 'ühe': 1, 'kahe': 2, 'kolme': 3, 'nelja': 4, 'viie': 5 };
      const n = words[m[1]] || +m[1];
      due = iso(addDays(today, m[2] === 'nädala' ? n * 7 : n));
    } else if ((m = find(R('järgmisel\\s+nädalal')))) {
      due = iso(addDays(today, ((8 - today.getDay()) % 7) || 7));
    } else if ((m = find(R('(\\d{1,2})\\.(\\d{1,2})\\.?(\\d{4})?')))) {
      due = fromDayMonth(today, +m[1], +m[2], m[3] && +m[3]);
    } else if ((m = find(R('(\\d{1,2})\\.?\\s+(' + MONTHS.join('|') + ')\\p{L}*')))) {
      due = fromDayMonth(today, +m[1], MONTHS.indexOf(m[2]) + 1);
    } else if ((m = find(WD_RE))) {
      let diff = (WEEKDAYS.indexOf(m[2]) - today.getDay() + 7) % 7;
      if (m[1] && diff === 0) diff = 7;
      due = iso(addDays(today, diff));
    }

    // päevaosa ("homme hommikul")
    for (const [re, t] of PARTS) {
      if ((m = find(re))) { if (!time) time = t; break; }
    }

    // ainult kellaaeg: täna, kui see pole möödas, muidu homme
    if (time && !due) {
      const [h, mi] = time.split(':').map(Number);
      const at = new Date(today); at.setHours(h, mi);
      due = iso(at > now ? today : addDays(today, 1));
    }

    const title = s.replace(/\s+([,.!?])/g, '$1')
      .replace(/\s{2,}/g, ' ').replace(/^[\s,.:;-]+|[\s,:;-]+$/g, '').trim();
    return { title: title.charAt(0).toUpperCase() + title.slice(1), due, time, tag };
  }

  function fromDayMonth(today, d, mo, y) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    let date = new Date(y || today.getFullYear(), mo - 1, d);
    if (date.getDate() !== d) return '';
    if (!y && date < addDays(today, -60)) date = new Date(today.getFullYear() + 1, mo - 1, d);
    return iso(date);
  }

  root.kkParse = parse;
  if (typeof module !== 'undefined') module.exports = parse;
})(typeof window !== 'undefined' ? window : globalThis);
