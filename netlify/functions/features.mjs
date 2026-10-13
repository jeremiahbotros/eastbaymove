// Home details that listings don't include — number of stories, garage spaces, pool — from
// RentCast property records. Used only when a visitor's plan asks for them (e.g. "Single story only",
// a minimum garage, "No garage" or "Pool upkeep" as a dealbreaker).
//   POST /api/features  { homes: [{ id, address }, ...] }   (max 24 per call)
//   -> { features: { [id]: { stories, garage, garageSpaces, pool } | null } }
// Cost: 1 RentCast lookup per home, the FIRST time any visitor needs it. Results are saved permanently
// (a home's stories and garage don't change), so every later visitor gets them free.
import { getStore } from '@netlify/blobs';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const store = () => globalThis.__TEST_FEAT_STORE || getStore('home-features');
const keyOf = id => 'v1-' + String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 180);

function pick(rec) {
  if (!rec) return null;
  const f = rec.features || {};
  return {
    stories: f.floorCount != null ? Number(f.floorCount) : null,
    garage: f.garage != null ? !!f.garage : (f.garageSpaces != null ? f.garageSpaces > 0 : null),
    garageSpaces: f.garageSpaces != null ? Number(f.garageSpaces) : null,
    pool: f.pool != null ? !!f.pool : null
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  let body;
  try { body = await req.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }
  const homes = (Array.isArray(body && body.homes) ? body.homes : []).filter(h => h && h.id && h.address && String(h.address).length < 200).slice(0, 24);
  let s = null; try { s = store(); } catch (_) {}
  const out = {};
  await Promise.all(homes.map(async h => {
    const k = keyOf(h.id);
    try { if (s) { const hit = await s.get(k, { type: 'json' }); if (hit) { out[h.id] = hit.f; return; } } } catch (_) {}
    try {
      const r = await fetch('https://api.rentcast.io/v1/properties?' + new URLSearchParams({ address: h.address }), { headers: { 'X-Api-Key': key, accept: 'application/json' } });
      if (!r.ok) { out[h.id] = null; return; }
      const j = await r.json();
      const f = pick(Array.isArray(j) ? j[0] : j);
      out[h.id] = f;
      if (s) { try { await s.setJSON(k, { at: Date.now(), f }); } catch (_) {} }
    } catch (_) { out[h.id] = null; }
  }));
  return json({ features: out });
};

export const config = { path: '/api/features' };
