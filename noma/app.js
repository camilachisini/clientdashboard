// Noma design tasks dashboard
// Viewers: reads data.json (refreshed from Asana by a GitHub Action).
// Editors: connect with an Asana personal access token (kept only in this browser),
// then tasks load live from Asana and can be dragged between days; moves are saved to Asana.

const PROJECT_ID = '1214040151426564';
const ORDER_FIELD = '1215421303249537'; // "Order" number field in Asana
const API = 'https://app.asana.com/api/1.0';
const TOKEN_KEY = 'nm-asana-token';

const CAP = 8;
const SLOTS = { T: 1, S: 2, M: 4, L: 8, XL: 12 };
const ALIAS = { TINY: 'T', SMALL: 'S', MEDIUM: 'M', LARGE: 'L', EXTRA: 'XL', XLARGE: 'XL' };
const SIZE_BG = { T: 'var(--t)', S: 'var(--s)', M: 'var(--m)', L: 'var(--l)', XL: 'var(--xl)' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GROUPS = {
  't-todo': ['To-do', ['To-do', 'Auto-created']],
  't-active': ['Active', ['In progress', 'Internal review', 'Shared with client', 'Pending Approval']],
  't-review': ['Under review', ['Shared with client', 'Pending Approval']]
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const label = (s) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
const weekday = (s) => new Date(s + 'T12:00:00').getDay();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const count = (tasks, list) => tasks.filter((t) => list.includes(t.status)).length;

const state = { tasks: [], updated: null, token: null, me: null, live: false, saving: 0 };

// ---------- data ----------
function sizeOf(t) {
  let g = String(t.size || '').trim().split(/[\s·(\-]/)[0].toUpperCase();
  if (ALIAS[g]) g = ALIAS[g];
  return SLOTS[g] ? { size: g, known: true } : { size: 'S', known: false };
}

function linkOf(t) {
  const c = String(t.client_link || '').trim();
  if (/^https?:\/\//i.test(c)) return { url: c, client: true };
  return { url: t.asana_url || `https://app.asana.com/0/0/${t.id}/f`, client: false };
}

function fromAsana(t) {
  const cf = (n) => { const f = (t.custom_fields || []).find((x) => x.name === n); return f ? f.display_value : null; };
  const order = (t.custom_fields || []).find((x) => x.gid === ORDER_FIELD);
  return {
    id: String(t.gid),
    name: String(t.name || '').trim(),
    designer: t.assignee && t.assignee.name ? t.assignee.name : 'Unassigned',
    owner: cf('Client task owner'),
    due: t.due_on || (cf('Client Due Date') ? String(cf('Client Due Date')).slice(0, 10) : null),
    status: cf('Status') || 'No status',
    size: cf('Task size'),
    client_link: cf('Client task link'),
    asana_url: t.permalink_url || null,
    order: order && order.number_value != null ? Number(order.number_value) : null
  };
}

async function asana(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Asana ${res.status}`);
  return res.json();
}

async function loadLive() {
  const fields = 'name,assignee.name,due_on,permalink_url,custom_fields.gid,custom_fields.name,custom_fields.display_value,custom_fields.number_value';
  let path = `/projects/${PROJECT_ID}/tasks?completed_since=2099-01-01T00:00:00Z&limit=100&opt_fields=${encodeURIComponent(fields)}`;
  const out = [];
  while (path) {
    const body = await asana(path);
    out.push(...body.data);
    path = body.next_page ? body.next_page.uri.replace(API, '') : null;
  }
  return out.map(fromAsana);
}

async function loadStatic() {
  const r = await fetch('data.json?t=' + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function refresh() {
  if (state.saving) return; // don't overwrite moves that are still saving
  try {
    if (state.token) {
      state.tasks = await loadLive();
      state.updated = new Date().toISOString();
      state.live = true;
    } else {
      const d = await loadStatic();
      state.tasks = d.tasks || [];
      state.updated = d.generated_at;
      state.live = false;
    }
    render();
  } catch (e) {
    if (state.token && state.live === false && !state.tasks.length) {
      toast('Could not reach Asana. Showing the last saved data.', true);
      state.token = null; refresh(); return;
    }
    if (!state.tasks.length) document.getElementById('board').replaceChildren(el('div', 'nm-msg', 'Could not load tasks.'));
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

// ---------- moving ----------
// Put task `id` on `date`, just before task `beforeId` (or at the end), renumber the day, save to Asana.
async function moveTask(id, date, beforeId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const before = state.tasks.map((t) => ({ id: t.id, due: t.due, order: t.order }));
  const plans = plan(state.tasks);
  const day = plans.find((p) => p.date === date);
  let ids = day ? [...day.fit, ...day.extra].map((p) => p.id).filter((x, i, a) => a.indexOf(x) === i && x !== id) : [];
  const at = beforeId && ids.includes(beforeId) ? ids.indexOf(beforeId) : ids.length;
  ids.splice(at, 0, id);
  const changes = new Map();
  task.due = date; changes.set(id, task);
  ids.forEach((x, i) => { const t = state.tasks.find((y) => y.id === x); if (t.order !== i + 1) { t.order = i + 1; changes.set(x, t); } });
  render();

  state.saving++;
  toast('Saving to Asana…');
  try {
    for (const t of changes.values()) {
      const data = { custom_fields: { [ORDER_FIELD]: t.order } };
      if (t.id === id) data.due_on = date;
      await asana(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
    }
    toast(`Moved to ${SHORT[weekday(date)]} ${label(date)} · saved in Asana`);
  } catch (e) {
    before.forEach((b) => { const t = state.tasks.find((x) => x.id === b.id); if (t) { t.due = b.due; t.order = b.order; } });
    render();
    toast('Could not save to Asana. The move was undone.', true);
  } finally {
    state.saving--;
  }
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'nm-toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'nm-toast'; }, 3500);
}

function openModal(kicker, title, note, content, neutral) {
  const back = el('div', 'nm-modal-back');
  const box = el('div', 'nm-modal');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
  const head = el('div', 'nm-modal-head');
  const h = el('div');
  h.append(el('p', 'nm-modal-kicker' + (neutral ? ' is-neutral' : ''), kicker), el('h2', 'nm-modal-title', title));
  const close = el('button', 'nm-modal-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close');
  head.append(h, close);
  box.append(head);
  if (note) box.append(el('p', 'nm-modal-note', note));
  box.append(content);
  back.appendChild(box);
  const shut = () => { back.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') shut(); };
  close.addEventListener('click', shut);
  back.addEventListener('click', (e) => { if (e.target === back) shut(); });
  document.addEventListener('keydown', esc);
  document.getElementById('noma-dashboard').appendChild(back);
  close.focus();
  return shut;
}

function makeCard(t) {
  const card = el('a', `nm-card sz-${t.size.toLowerCase()}`);
  const lk = linkOf(t);
  card.href = lk.url; card.target = '_blank'; card.rel = 'noopener';
  card.dataset.id = t.id;
  if (t.part < t.parts) card.classList.add('cont-next');
  if (t.part > 1) card.classList.add('cont-prev');
  card.title = `${lk.client ? 'Open in the client’s Asana' : 'Open in Asana'}\n${t.name}\nOwner: ${t.owner || '—'}\nDesigner: ${t.designer}\nStatus: ${t.status}\nDue: ${label(t.due)}`;
  const top = el('div', 'nm-card-top');
  top.append(el('div', 'nm-card-name', t.name), el('span', 'nm-size', t.size + (t.known ? '' : '*')));
  const bottom = el('div', 'nm-card-bottom');
  const who = el('span', 'nm-designer', t.owner || t.designer);
  if (t.owner) who.appendChild(el('em', null, ` · ${t.designer.split(' ')[0]}`));
  bottom.appendChild(who);
  if (t.parts > 1) bottom.appendChild(el('span', 'nm-part', `${t.part > 1 ? '← ' : ''}${t.part}/${t.parts}${t.part < t.parts ? ' →' : ''}`));
  card.append(top, bottom);
  if (state.token) {
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging'); document.body.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.body.classList.remove('is-dragging'); clearDrop(); });
  }
  return card;
}

function moveControls(t, shut) {
  const box = el('div', 'nm-move');
  box.appendChild(el('span', 'nm-move-label', 'Move to'));
  windowDates().forEach((d) => {
    if (d === t.due) return;
    const b = el('button', 'nm-move-day', `${SHORT[weekday(d)]} ${Number(d.slice(8))}`); b.type = 'button';
    b.addEventListener('click', () => { shut(); moveTask(t.id, d, null); });
    box.appendChild(b);
  });
  const other = el('input', 'nm-move-date'); other.type = 'date'; other.title = 'Another date';
  other.addEventListener('change', () => {
    if (!other.value) return;
    const wd = weekday(other.value);
    if (wd === 0 || wd === 6) { toast('Pick a weekday.', true); other.value = ''; return; }
    shut(); moveTask(t.id, other.value, null);
  });
  box.appendChild(other);
  return box;
}

function openOver(title, list) {
  const grid = el('div', 'nm-modal-list');
  let shut;
  list.forEach((t) => {
    const wrap = el('div', 'nm-over-item');
    wrap.style.gridColumn = `span ${Math.min(t.slots, 4)}`;
    const c = makeCard(t); c.draggable = false;
    wrap.appendChild(c);
    if (state.token) wrap.appendChild(moveControls(t, () => shut()));
    grid.appendChild(wrap);
  });
  const hours = list.reduce((a, t) => a + t.slots, 0);
  shut = openModal('Over capacity', title, `These ${hours}h don't fit in the 8 slots of this day.${state.token ? ' Move them to another day:' : ' Connect Asana to move them.'}`, grid);
}

function openList(name, list) {
  const rows = [...list].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.name.localeCompare(b.name));
  let content;
  if (!rows.length) content = el('p', 'nm-msg', 'No tasks here right now.');
  else {
    content = el('table', 'nm-tl');
    const head = el('tr');
    ['Size', 'Task', 'Client owner', 'Designer', 'Status', 'Due'].forEach((h) => head.appendChild(el('th', null, h)));
    const thead = el('thead'); thead.appendChild(head);
    const tbody = el('tbody');
    rows.forEach((t) => {
      const s = sizeOf(t);
      const tr = el('tr');
      const chip = el('span', 'nm-chip', s.known ? s.size : '—'); if (s.known) chip.style.background = SIZE_BG[s.size];
      const c0 = el('td'); c0.appendChild(chip);
      const nameTd = el('td', 'nm-tl-name');
      const lk = linkOf(t);
      const a = el('a', null, t.name); a.href = lk.url; a.target = '_blank'; a.rel = 'noopener';
      a.title = lk.client ? 'Open in the client’s Asana' : 'Open in Asana';
      nameTd.appendChild(a);
      const c4 = el('td'); c4.appendChild(el('span', 'nm-status', t.status));
      tr.append(c0, nameTd, el('td', t.owner ? null : 'nm-muted', t.owner || '—'), el('td', null, t.designer), c4, el('td', t.due ? null : 'nm-muted', t.due ? label(t.due) : 'No date'));
      tbody.appendChild(tr);
    });
    content.append(thead, tbody);
  }
  openModal('Noma tasks', name, rows.length === 1 ? '1 open task' : `${rows.length} open tasks`, content, true);
}

// ---------- drag and drop on the board ----------
let marker;
function clearDrop() {
  document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
  if (marker) marker.remove();
}
function dropIndex(track, x) {
  const cards = [...track.querySelectorAll('a.nm-card:not(.dragging)')];
  let i = 0;
  for (const c of cards) { const r = c.getBoundingClientRect(); if (x > r.left + r.width / 2) i++; }
  return { i, cards };
}
function wireTrack(track, date) {
  track.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    clearDrop(); track.classList.add('drop-on');
    const { i, cards } = dropIndex(track, e.clientX);
    marker = el('div', 'nm-drop-marker');
    const tr = track.getBoundingClientRect();
    const x = cards.length === 0 ? 4 : i < cards.length ? cards[i].getBoundingClientRect().left - tr.left - 8 : cards[cards.length - 1].getBoundingClientRect().right - tr.left + 4;
    marker.style.left = `${x}px`;
    track.appendChild(marker);
  });
  track.addEventListener('dragleave', (e) => { if (!track.contains(e.relatedTarget)) clearDrop(); });
  track.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const { i, cards } = dropIndex(track, e.clientX);
    // index among the day's own task ids, ignoring the dragged one
    const before = i < cards.length ? cards[i].dataset.id : null;
    clearDrop();
    moveTask(id, date, before === id ? null : before);
  });
}

// ---------- render ----------
function render() {
  document.querySelectorAll('.nm-modal-back').forEach((m) => m.remove());
  const tasks = state.tasks;
  document.getElementById('t-todo').textContent = count(tasks, GROUPS['t-todo'][1]);
  document.getElementById('t-active').textContent = count(tasks, GROUPS['t-active'][1]);
  document.getElementById('t-review').textContent = count(tasks, GROUPS['t-review'][1]);

  const today = iso(new Date());
  const board = document.getElementById('board');
  board.replaceChildren();
  document.body.classList.toggle('can-edit', !!state.token);

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
    track.style.gridTemplateColumns = `repeat(${CAP}, minmax(0, 1fr)) var(--more-w)`;
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
    if (d.extra.length) {
      const hours = d.extra.reduce((a, t) => a + t.slots, 0);
      const btn = el('button', 'nm-more'); btn.type = 'button';
      btn.setAttribute('aria-label', `${d.extra.length} more tasks, ${hours} hours over capacity`);
      btn.append(el('span', 'nm-more-plus', '+'), el('span', 'nm-more-n', `${hours}h`), el('span', 'nm-more-t', d.extra.length === 1 ? '1 task' : `${d.extra.length} tasks`));
      btn.style.gridColumn = String(CAP + 1);
      btn.addEventListener('click', () => openOver(d.date === today ? `Today · ${label(d.date)}` : `${DAYS[wd]} · ${label(d.date)}`, d.extra));
      track.appendChild(btn);
    }
    if (state.token) wireTrack(track, d.date);
    row.append(day, track);
    board.appendChild(row);
  });

  const updated = state.updated ? new Date(state.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const hold = count(tasks, ['On Hold']);
  document.getElementById('foot').textContent =
    `${state.live ? 'Live from Asana' : 'Updated from Asana'} ${updated} · Next 5 working days · Tasks sit on their due date, in Asana order · red + = tasks that don't fit in the day · ${hold} on hold, not shown · * no size in Asana, counted as Small`;
  renderEditButton();
}

function renderEditButton() {
  const b = document.getElementById('edit');
  b.replaceChildren();
  if (state.token) {
    b.append(el('span', 'nm-dot'), document.createTextNode(state.me ? `Editing as ${state.me.split(' ')[0]}` : 'Editing'));
    b.title = 'Drag tasks to change their day or order. Click to stop editing on this device.';
  } else {
    b.textContent = 'Edit schedule';
    b.title = 'Connect your Asana account to move tasks';
  }
}

function openConnect() {
  if (state.token) {
    const box = el('div');
    const out = el('button', 'nm-btn', 'Stop editing on this device'); out.type = 'button';
    box.append(el('p', 'nm-modal-note', 'Drag a card to another day or position to move it. Use the red + to move tasks that don’t fit. Every move updates the due date and order in Asana.'), out);
    const shut = openModal('Editing', state.me || 'Connected to Asana', null, box, true);
    out.addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); state.token = null; state.me = null; shut(); refresh(); });
    return;
  }
  const form = el('form', 'nm-connect');
  form.append(el('p', 'nm-modal-note', 'Paste your Asana personal access token (Asana → Settings → Apps → View developer console). It stays only in this browser and is used to save moves to Asana.'));
  const input = el('input', 'nm-input'); input.type = 'password'; input.placeholder = 'Asana personal access token'; input.autocomplete = 'off'; input.required = true;
  const go = el('button', 'nm-btn', 'Connect'); go.type = 'submit';
  const err = el('p', 'nm-err');
  form.append(input, go, err);
  const shut = openModal('Edit schedule', 'Connect Asana', null, form, true);
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true; err.textContent = 'Checking…';
    state.token = input.value.trim();
    try {
      const me = await asana('/users/me?opt_fields=name');
      state.me = me.data.name;
      localStorage.setItem(TOKEN_KEY, state.token);
      shut(); await refresh();
      toast('Connected. Drag tasks to move them.');
    } catch (x) {
      state.token = null; go.disabled = false;
      err.textContent = 'That token didn’t work. Check it and try again.';
    }
  });
}

// ---------- start ----------
Object.entries(GROUPS).forEach(([id, [name, statuses]]) => {
  document.getElementById('b-' + id).addEventListener('click', () => openList(name, state.tasks.filter((t) => statuses.includes(t.status))));
});
document.getElementById('edit').addEventListener('click', openConnect);

(async () => {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    state.token = saved;
    try { state.me = (await asana('/users/me?opt_fields=name')).data.name; }
    catch (e) { state.token = null; localStorage.removeItem(TOKEN_KEY); }
  }
  refresh();
  setInterval(refresh, 2 * 60 * 1000);
})();
