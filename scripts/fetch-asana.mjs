// Pulls the open tasks of the Noma project from Asana and writes data.json.
// Needs ASANA_TOKEN (a Personal Access Token) in the environment.
// Run locally:  ASANA_TOKEN=xxx node scripts/fetch-asana.mjs
import { writeFile } from 'node:fs/promises';

const PROJECT_ID = process.env.ASANA_PROJECT_ID || '1214040151426564';
const TOKEN = process.env.ASANA_TOKEN;
if (!TOKEN) { console.error('Missing ASANA_TOKEN'); process.exit(1); }

const fields = 'name,assignee.name,due_on,custom_fields.name,custom_fields.display_value';
let url = `https://app.asana.com/api/1.0/projects/${PROJECT_ID}/tasks?completed_since=2099-01-01T00:00:00Z&limit=100&opt_fields=${encodeURIComponent(fields)}`;
const raw = [];
while (url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) { console.error('Asana error', res.status, await res.text()); process.exit(1); }
  const body = await res.json();
  raw.push(...body.data);
  url = body.next_page ? body.next_page.uri : null;
}

const cf = (t, n) => { const f = (t.custom_fields || []).find((x) => x.name === n); return f ? f.display_value : null; };
const day = (v) => (v ? String(v).slice(0, 10) : null);

// Only the fields the dashboard shows are published.
const tasks = raw.map((t) => ({
  id: String(t.gid),
  name: String(t.name || '').trim(),
  designer: t.assignee && t.assignee.name ? t.assignee.name : 'Unassigned',
  owner: cf(t, 'Client task owner'),
  due: t.due_on || day(cf(t, 'Client Due Date')),
  status: cf(t, 'Status') || 'No status',
  size: cf(t, 'Task size')
}));

await writeFile(process.env.OUTPUT || 'noma/data.json', JSON.stringify({ generated_at: new Date().toISOString(), tasks }, null, 2) + '\n');
console.log(`Wrote ${tasks.length} tasks`);
