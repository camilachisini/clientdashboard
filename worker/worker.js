// Cloudflare Worker: returns the Noma project's open tasks from Asana, live.
// Secret needed: ASANA_TOKEN (Settings → Variables and Secrets → Add → type "Secret").
// Responses are cached for 60 seconds; add ?fresh=1 to skip the cache.

const PROJECT_ID = '1214040151426564';
const ALLOWED_ORIGIN = 'https://camilachisini.github.io';
const FIELDS = 'name,assignee.name,due_on,permalink_url,custom_fields.gid,custom_fields.name,custom_fields.display_value,custom_fields.number_value';

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const fresh = url.searchParams.has('fresh');
    const cache = caches.default;
    const key = new Request(url.origin + '/tasks');
    if (!fresh) {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: cors });
    }

    try {
      const tasks = [];
      let next = `https://app.asana.com/api/1.0/projects/${PROJECT_ID}/tasks?completed_since=2099-01-01T00:00:00Z&limit=100&opt_fields=${encodeURIComponent(FIELDS)}`;
      while (next) {
        const r = await fetch(next, { headers: { Authorization: `Bearer ${env.ASANA_TOKEN}` } });
        if (!r.ok) throw new Error(`Asana ${r.status}`);
        const body = await r.json();
        tasks.push(...body.data);
        next = body.next_page ? body.next_page.uri : null;
      }
      const cf = (t, n) => { const f = (t.custom_fields || []).find((x) => x.name === n); return f ? f.display_value : null; };
      const out = {
        generated_at: new Date().toISOString(),
        tasks: tasks.map((t) => {
          const order = (t.custom_fields || []).find((x) => x.name === 'Order');
          const clientDue = cf(t, 'Client Due Date');
          return {
            id: String(t.gid),
            name: String(t.name || '').trim(),
            designer: t.assignee && t.assignee.name ? t.assignee.name : 'Unassigned',
            owner: cf(t, 'Client task owner'),
            due: t.due_on || (clientDue ? String(clientDue).slice(0, 10) : null),
            status: cf(t, 'Status') || 'No status',
            size: cf(t, 'Task size'),
            order: order && order.number_value != null ? Number(order.number_value) : null
          };
        })
      };
      const json = JSON.stringify(out);
      ctx.waitUntil(cache.put(key, new Response(json, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } })));
      return new Response(json, { headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: cors });
    }
  }
};
