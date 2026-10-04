// Receives Next Move submissions and forwards them to your Zapier "Catch Hook".
// Keeps the Zapier URL private. Setup: Netlify > Site configuration > Environment variables >
// add ZAPIER_HOOK_URL (the Catch Hook URL from your Zap).
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);

  const hook = process.env.ZAPIER_HOOK_URL;
  if (!hook) return json({ error: 'not_configured' }, 503);

  let data;
  try { data = await req.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }
  if (!data || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '') || String(data.phone || '').replace(/\D/g, '').length < 10) return json({ error: 'invalid' }, 400);
  if (JSON.stringify(data).length > 200000) return json({ error: 'too_large' }, 413);

  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) return json({ error: 'forward_failed', status: r.status }, 502);
  } catch (_) { return json({ error: 'forward_failed' }, 502); }
  return json({ ok: true });
};

export const config = { path: '/api/lead' };
