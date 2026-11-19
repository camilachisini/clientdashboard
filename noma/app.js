// Noma design tasks dashboard
// Static view for sharing as an image. Reads data.json (refreshed from Asana by a GitHub Action).

const CAP = 8;
const SLOTS = { T: 1, S: 2, M: 4, L: 8, XL: 12 };
const ALIAS = { TINY: 'T', SMALL: 'S', MEDIUM: 'M', LARGE: 'L', EXTRA: 'XL', XLARGE: 'XL' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const label = (s) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
const weekday = (s) => new Date(s + 'T12:00:00').getDay();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const count = (tasks, list) => tasks.filter((t) => list.includes(t.status)).length;

const state = { tasks: [], updated: null, live: false };

// ---------- data ----------
function sizeOf(t) {
  let g = String(t.size || '').trim().split(/[\s·(\-]/)[0].toUpperCase();
  if (ALIAS[g]) g = ALIAS[g];
  return SLOTS[g] ? { size: g, known: true } : { size: 'S', known: false };
}

// Live data comes from the Cloudflare Worker (keeps the Asana token secret).
// If it isn't set up or doesn't answer, the page falls back to data.json from the GitHub Action.
const LIVE_URL = '';

async function getData(fresh) {
  if (LIVE_URL) {
    try {
      const r = await fetch(LIVE_URL + (fresh ? '?fresh=1' : ''), { cache: 'no-store' });
      if (r.ok) return { ...(await r.json()), live: true };
    } catch (e) { /* fall back */ }
  }
  const r = await fetch('data.json?t=' + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function refresh(fresh) {
  try {
    const d = await getData(fresh);
    state.tasks = d.tasks || [];
    state.updated = d.generated_at;
    state.live = !!d.live;
    render();
    return true;
  } catch (e) {
    if (!state.tasks.length) document.getElementById('board').replaceChildren(el('div', 'nm-msg', 'Could not load tasks.'));
    return false;
  }
}

// ---------- schedule ----------
function windowDates() {
  const dates = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  while (dates.length < 5) { if (d.getDay() % 6) dates.push(iso(d)); d.setDate(d.getDate() + 1); }
  return dates;
}

// Each task sits on its due date, in its Asana "Order". Tasks bigger than a day (XL)
// put their first 8h on the working day before. What doesn't fit in 8 slots is overflow.
function plan(tasks) {
  const dates = windowDates();
  const days = new Map(dates.map((d) => [d, []]));
  const rank = (t) => (t.order == null ? 1e9 : t.order);
  tasks
    .filter((t) => t.due && days.has(t.due) && t.status !== 'On Hold')
    .map((t) => { const s = sizeOf(t); return { ...t, size: s.size, known: s.known, total: SLOTS[s.size] }; })
    .sort((a, b) => rank(a) - rank(b) || b.total - a.total || a.name.localeCompare(b.name))
    .forEach((t) => {
      const i = dates.indexOf(t.due);
      if (t.total > CAP && i > 0) {
        days.get(dates[i - 1]).unshift({ ...t, slots: CAP, part: 1, parts: 2, date: dates[i - 1] });
        days.get(t.due).push({ ...t, slots: t.total - CAP, part: 2, parts: 2, date: t.due });
      } else {
        days.get(t.due).push({ ...t, slots: t.total, part: 1, parts: 1, date: t.due });
      }
    });
  return dates.map((date) => {
    const list = days.get(date);
    const fit = []; const extra = []; let used = 0;
    list.forEach((p) => { if (used + p.slots <= CAP) { fit.push(p); used += p.slots; } else extra.push(p); });
    return { date, fit, extra, used, total: list.reduce((a, p) => a + p.slots, 0) };
  });
}

// ---------- render ----------
function makeCard(t) {
  const card = el('div', `nm-card sz-${t.size.toLowerCase()}`);
  if (t.part < t.parts) card.classList.add('cont-next');
  if (t.part > 1) card.classList.add('cont-prev');
  const top = el('div', 'nm-card-top');
  top.append(el('div', 'nm-card-name', t.name), el('span', 'nm-size', t.size));
  const bottom = el('div', 'nm-card-bottom');
  bottom.appendChild(el('span', 'nm-designer', t.owner || ''));
  if (t.parts > 1) bottom.appendChild(el('span', 'nm-part', `${t.part > 1 ? '← ' : ''}${t.part}/${t.parts}${t.part < t.parts ? ' →' : ''}`));
  card.append(top, bottom);
  return card;
}

function render() {
  const tasks = state.tasks;
  document.getElementById('t-todo').textContent = count(tasks, ['To-do', 'Auto-created']);
  document.getElementById('t-active').textContent = count(tasks, ['In progress', 'Internal review', 'Shared with client', 'Pending Approval']);
  document.getElementById('t-review').textContent = count(tasks, ['Shared with client', 'Pending Approval']);

  const today = iso(new Date());
  const board = document.getElementById('board');
  board.replaceChildren();

  plan(tasks).forEach((d, i) => {
    const wd = weekday(d.date);
    if (i > 0 && wd === 1) board.appendChild(el('div', 'nm-week', 'Next week'));
    const row = el('div', 'nm-row' + (d.date === today ? ' is-today' : ''));
    const free = CAP - d.total;

    const day = el('div', 'nm-day');
    day.append(el('span', 'nm-day-name', d.date === today ? 'Today' : DAYS[wd]), el('span', 'nm-day-date', label(d.date)));
    const cap = el('div', 'nm-cap');
    cap.appendChild(el('span', 'nm-cap-n', `${d.total} / ${CAP} slots${free > 0 ? ` · ${free} free` : ''}`));
    if (d.total === CAP) cap.appendChild(el('span', 'nm-badge', 'FULL'));
    if (d.total > CAP) cap.appendChild(el('span', 'nm-badge is-over', `+${d.total - CAP}h OVER`));
    day.appendChild(cap);

    const track = el('div', 'nm-track');
    track.style.gridTemplateColumns = `repeat(${CAP}, minmax(0, 1fr))`;
    let start = 1;
    d.fit.forEach((t) => {
      const card = makeCard(t);
      card.style.gridColumn = `${start} / span ${t.slots}`; start += t.slots;
      track.appendChild(card);
    });
    for (let k = start; k <= CAP; k++) {
      const slot = el('div', 'nm-slot'); slot.style.gridColumn = String(k);
      if (k === start && !d.extra.length) slot.appendChild(el('span', null, CAP - d.used === 1 ? '1 free slot' : `${CAP - d.used} free slots`));
      track.appendChild(slot);
    }
    const lane = el('div', 'nm-lane');
    lane.appendChild(track);
    if (d.extra.length) {
      // Tasks that don't fit: same slot sizes, in red, on extra lines under the day.
      const over = el('div', 'nm-track nm-over-track');
      over.style.gridTemplateColumns = `repeat(${CAP}, minmax(0, 1fr))`;
      let line = 1; let col = 1;
      d.extra.forEach((t) => {
        const span = Math.min(t.slots, CAP);
        if (col + span - 1 > CAP) { line++; col = 1; }
        const card = makeCard(t);
        card.classList.add('is-over');
        card.querySelector('.nm-card-name').prepend(el('span', 'nm-warn', '⚠'));
        card.style.gridColumn = `${col} / span ${span}`;
        card.style.gridRow = String(line);
        col += span;
        over.appendChild(card);
      });
      over.style.gridTemplateRows = `repeat(${line}, minmax(0, 1fr))`;
      over.style.flex = String(line);
      lane.appendChild(over);
      row.style.flex = String(1 + line);
    }
    row.append(day, lane);
    board.appendChild(row);
  });

  const updated = state.updated ? new Date(state.updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  document.getElementById('foot').textContent = `${state.live ? 'Live from Asana' : 'Updated'} ${updated} · Next 5 working days · 1 slot = 1 hour · red ⚠ = tasks that don't fit in the 8 slots of the day`;
}

// ---------- download ----------
// The image is always 1920 × 1080 (at 2x): the page is rendered in a hidden frame of that size and captured there.
const RENDER_MODE = new URLSearchParams(location.search).has('render');
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

if (RENDER_MODE) {
  document.body.classList.add('render-mode');
} else {
  document.getElementById('download').addEventListener('click', async () => {
    const btn = document.getElementById('download');
    btn.disabled = true; btn.textContent = 'Preparing…';
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1920px;height:1080px;border:0;';
    frame.src = 'index.html?render=1';
    document.body.appendChild(frame);
    try {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), 20000);
        frame.addEventListener('load', async () => {
          try { await frame.contentWindow.nmReady; clearTimeout(t); res(); } catch (e) { rej(e); }
        });
      });
      const w = frame.contentWindow;
      const node = w.document.getElementById('noma-dashboard');
      await w.document.fonts.ready;
      const url = await w.htmlToImage.toPng(node, { width: 1920, height: 1080, pixelRatio: 2, backgroundColor: '#F7F9F2' });
      const a = document.createElement('a');
      a.download = `noma-design-tasks-${iso(new Date())}.png`;
      a.href = url; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      alert('Could not create the image. Please try again.');
    } finally {
      frame.remove();
      btn.disabled = false; btn.textContent = 'Download image';
    }
  });
}
window.nmReady = ready;

// ---------- update now ----------
if (!RENDER_MODE) {
  const ub = document.getElementById('update');
  if (!LIVE_URL) ub.hidden = true;
  ub.addEventListener('click', async () => {
    ub.disabled = true; ub.textContent = 'Updating…';
    const ok = await refresh(true);
    ub.textContent = ok && state.live ? 'Updated ✓' : 'Could not update';
    setTimeout(() => { ub.textContent = 'Update now'; ub.disabled = false; }, 2500);
  });
}

refresh().then(() => readyResolve());
setInterval(refresh, 5 * 60 * 1000);
