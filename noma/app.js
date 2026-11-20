// Noma design tasks dashboard
// Static view for sharing as an image. Reads data.json (refreshed from Asana by a GitHub Action).

const CAP = 8;
const SLOTS = { T: 1, S: 2, M: 4, L: 8, XL: 12 };
const ALIAS = { TINY: 'T', SMALL: 'S', MEDIUM: 'M', LARGE: 'L', EXTRA: 'XL', XLARGE: 'XL' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const label = (s) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
const weekday = (s) => new Date(s + 'T12:00:00').getDay();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const count = (tasks, list) => tasks.filter((t) => !t.completed && list.includes(t.status)).length;
const DELIVERED = ['Shared with client', 'Pending Approval', 'Complete'];
const isDelivered = (t) => t.completed || DELIVERED.includes(t.status);
const deliveredOn = (t) => (t.delivered_at ? iso(new Date(t.delivered_at)) : null);

const state = { tasks: [], updated: null, live: false };

// ---------- data ----------
function sizeOf(t) {
  let g = String(t.size || '').trim().split(/[\s·(\-]/)[0].toUpperCase();
  if (ALIAS[g]) g = ALIAS[g];
  return SLOTS[g] ? { size: g, known: true } : { size: 'S', known: false };
}

// Live data comes from the Cloudflare Worker (keeps the Asana token secret).
// If it isn't set up or doesn't answer, the page falls back to data.json from the GitHub Action.
// On Cloudflare this is served by functions/api/tasks.js; elsewhere it 404s and the page falls back to data.json.
const LIVE_URL = '/api/tasks';

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
    // The last successful Asana check (even with no changes) comes from GitHub's public run list,
    // so the time moves on every check without publishing a new file.
    try {
      const r = await fetch('https://api.github.com/repos/camilachisini/clientdashboard/actions/workflows/update-data.yml/runs?status=success&per_page=1', { cache: 'no-store' });
      if (r.ok) {
        const run = ((await r.json()).workflow_runs || [])[0];
        if (run && (!state.updated || run.updated_at > state.updated)) state.updated = run.updated_at;
      }
    } catch (e) { /* keep the data time */ }
    state.live = !!d.live;
    render();
    return true;
  } catch (e) {
    if (!state.tasks.length) document.getElementById('board').replaceChildren(el('div', 'nm-msg', 'Could not load tasks.'));
    return false;
  }
}

// ---------- schedule ----------
function workingDays(n) {
  const dates = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  while (dates.length < n) { if (d.getDay() % 6) dates.push(iso(d)); d.setDate(d.getDate() + 1); }
  return dates;
}
const windowDates = () => workingDays(5);

// Scheduling rules
// 1. Only work delivered today stays on today (faded); earlier deliveries drop off.
// 2. Work already started goes first: Internal review, then In progress.
// 3. Then everything else by Client Due Date (earliest first); tasks due far ahead fill free slots;
//    tasks with no Client Due Date fill whatever is left.
// Work is poured into 8-slot days from today on, splitting across days when needed, so slots never sit empty.
// A piece that lands after its due date is an overage: it blocks the next free slots and is flagged
// to confirm the new date with the client.
function plan(tasks) {
  const horizon = workingDays(60);
  const dates = horizon.slice(0, 5);
  const today = dates[0];
  const rank = (t) => (t.order == null ? 1e9 : t.order);
  const stage = (t) => (t.status === 'Internal review' ? 2 : t.status === 'In progress' ? 1 : 0);
  const ON_BOARD = ['To-do', 'Auto-created', 'In progress', 'Internal review'];
  const prep = (t) => { const s = sizeOf(t); return { ...t, clientDue: t.due, size: s.size, known: s.known, total: SLOTS[s.size] }; };

  const days = new Map(horizon.map((d) => [d, []]));
  const used = new Map(horizon.map((d) => [d, 0]));

  tasks.filter((t) => isDelivered(t) && deliveredOn(t) === today).map(prep)
    .forEach((t) => { days.get(today).push({ ...t, done: true, slots: t.total, date: today }); used.set(today, used.get(today) + t.total); });

  const open = tasks.filter((t) => !t.completed && ON_BOARD.includes(t.status)).map(prep);
  const started = open.filter((t) => stage(t) > 0).sort((a, b) => stage(b) - stage(a) || rank(a) - rank(b) || (a.due || '9999').localeCompare(b.due || '9999'));
  const rest = open.filter((t) => stage(t) === 0).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || rank(a) - rank(b) || b.total - a.total || a.name.localeCompare(b.name));

  let i = 0;
  [...started, ...rest].forEach((t) => {
    let left = t.total;
    while (left > 0 && i < horizon.length) {
      const d = horizon[i];
      const free = CAP - used.get(d);
      if (free <= 0) { i++; continue; }
      const take = Math.min(free, left);
      days.get(d).push({ ...t, slots: take, date: d, late: !!(t.due && d > t.due && t.due >= today) });
      used.set(d, used.get(d) + take);
      left -= take;
    }
  });

  // Number the pieces of split tasks (1/2, 2/2…).
  const pieces = new Map();
  horizon.forEach((d) => days.get(d).forEach((p) => { if (!pieces.has(p.id)) pieces.set(p.id, []); pieces.get(p.id).push(p); }));
  pieces.forEach((list) => list.forEach((p, k) => { p.part = k + 1; p.parts = list.length; }));

  return dates.map((date) => {
    const list = days.get(date);
    const fit = []; const extra = []; let n = 0;
    list.forEach((p) => { if (n + p.slots <= CAP) { fit.push(p); n += p.slots; } else extra.push(p); });
    // Work due this day that doesn't fit before it: shown in red under the day,
    // and as ghost cards in the next free slots (a suggestion to confirm with the client).
    const lateHere = new Map();
    horizon.filter((d) => d > date).forEach((d) => days.get(d).forEach((p) => {
      if (p.late && p.due === date) lateHere.set(p.id, { ...(lateHere.get(p.id) || p), slots: ((lateHere.get(p.id) || {}).slots || 0) + p.slots, late: false, part: 1, parts: 1 });
    }));
    lateHere.forEach((p) => extra.push(p));
    const moved = [...lateHere.values()].reduce((a, p) => a + p.slots, 0);
    return { date, fit, extra, used: n, total: list.reduce((a, p) => a + p.slots, 0), moved };
  });
}

// ---------- render ----------
function makeCard(t) {
  const card = el('div', `nm-card sz-${t.size.toLowerCase()}`);
  if (t.part < t.parts) card.classList.add('cont-next');
  if (t.part > 1) card.classList.add('cont-prev');
  const top = el('div', 'nm-card-top');
  const head = el('div', 'nm-card-head');
  const nameEl = el('div', 'nm-card-name', t.name);
  head.appendChild(nameEl);
  if (t.owner) head.appendChild(el('div', 'nm-card-due', t.owner));
  const badges = el('div', 'nm-badges');
  if (String(t.priority || '').toLowerCase() === 'high') badges.appendChild(el('span', 'nm-high', 'High'));
  badges.appendChild(el('span', 'nm-size', t.size));
  top.append(head, badges);
  const bottom = el('div', 'nm-card-bottom');
  const dueTxt = t.clientDue ? `${MONTHS_SHORT[Number(t.clientDue.slice(5, 7)) - 1]} ${Number(t.clientDue.slice(8, 10))}` : 'No due date yet';
  bottom.appendChild(el('span', 'nm-designer', t.late ? `Proposed date: ${MONTHS_SHORT[Number(t.date.slice(5, 7)) - 1]} ${Number(t.date.slice(8, 10))} · Pending client approval` : dueTxt));
  if (t.late) card.classList.add('is-ghost');
  if (t.done) { card.classList.add('is-done'); bottom.appendChild(el('span', 'nm-done', '✓ Delivered')); }
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
    const over = Math.max(0, d.total - CAP) + d.moved;
    if (over > 0) cap.appendChild(el('span', 'nm-badge is-over', `+${over}h OVER`));
    else if (d.total === CAP) cap.appendChild(el('span', 'nm-badge', 'FULL'));
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
      row.style.minHeight = `${88 + line * 58}px`;
    }
    row.append(day, lane);
    board.appendChild(row);
  });

  const updated = state.updated ? new Date(state.updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  document.getElementById('foot').textContent = `Updated ${updated}`;
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
