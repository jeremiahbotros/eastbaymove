// Saved Next Move plans: short share links, plus Jeremiah's CMA review.
//   POST /api/plan[?id=X]  {snapshot, contact}        -> {id}   (create or refresh a client's plan)
//   GET  /api/plan?id=X                               -> {snapshot, override}
//   GET  /api/plan?id=X   (header x-agent-key: <edit token>)        -> full record incl. contact
//   POST /api/plan?id=X   (header x-agent-key: <edit token>) {override} -> save Jeremiah's value/comps/note
// No setup: every plan gets its own random edit token, created here and only ever sent to
// Jeremiah inside the Lofty note link (added by lead.mjs). Clients never see it.
import { getStore } from '@netlify/blobs';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ID = /^[A-Za-z0-9]{8,16}$/;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => ALPHA[x % ALPHA.length]).join('');
const newId = () => rand(10);
export const newToken = () => rand(24);
const store = () => globalThis.__TEST_STORE || getStore('next-move-plans');

export default async (req) => {
  const url = new URL(req.url);
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);

  const id = url.searchParams.get('id') || '';
  const sentKey = req.headers.get('x-agent-key') || '';
  const s = store();
  const isAgentFor = rec => !!sentKey && !!rec && ((!!rec.editToken && sentKey === rec.editToken) || (!!process.env.AGENT_KEY && sentKey === process.env.AGENT_KEY));

  if (req.method === 'GET') {
    if (!ID.test(id)) return json({ error: 'bad_id' }, 400);
    const rec = await s.get(id, { type: 'json' });
    if (!rec) return json({ error: 'not_found' }, 404);
    const isAgent = isAgentFor(rec);
    if (sentKey && !isAgent) return json({ error: 'bad_key' }, 401);
    if (isAgent){ const { editToken, ...safe } = rec; return json(safe); }
    return json({ snapshot: rec.snapshot, override: rec.override || null });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }
    if (!body || JSON.stringify(body).length > 200000) return json({ error: 'too_large' }, 413);

    if (body.override !== undefined) {
      if (!ID.test(id)) return json({ error: 'bad_id' }, 400);
      const rec = await s.get(id, { type: 'json' });
      if (!rec) return json({ error: 'not_found' }, 404);
      if (!isAgentFor(rec)) return json({ error: 'bad_key' }, 401);
      rec.override = body.override; rec.updated = Date.now();
      await s.setJSON(id, rec);
      return json({ ok: true, id });
    }

    if (!body.snapshot || !body.snapshot.plan) return json({ error: 'bad_request' }, 400);
    let rec = ID.test(id) ? await s.get(id, { type: 'json' }) : null;
    const key = rec ? id : newId();
    const snap = Object.assign({}, body.snapshot); delete snap.override;
    rec = Object.assign({}, rec || {}, { snapshot: snap, contact: body.contact || (rec && rec.contact) || null, created: (rec && rec.created) || Date.now(), updated: Date.now(), editToken: (rec && rec.editToken) || newToken() });
    await s.setJSON(key, rec);
    return json({ id: key });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/plan' };
