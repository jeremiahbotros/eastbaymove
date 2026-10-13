// Every home for sale right now in one city, for the "Your Next Move" plan page (RentCast /listings/sale).
//   GET /api/listings?city=Brentwood&beds=3&baths=2&type=Single Family Home
// - Runs ONLY when a visitor scrolls to "Homes that fit" or taps a city. Nothing runs on a schedule.
// - Pulls all active listings for the city (500 per lookup), then drops anything RentCast hasn't
//   seen on the market in the last 3 days (sold / pending / pulled).
// - Each city is fetched at most once a day (RentCast itself updates daily); every visitor that day
//   shares that copy via Netlify Blobs. Sliders and filters run in the browser and cost nothing.
// - Optional Netlify variables: LISTINGS_TTL_MIN (default 1440 = 24h), LISTINGS_MAX_PAGES (default 1).
import { getStore } from '@netlify/blobs';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const TYPES = { 'Single Family Home': 'Single Family', 'Condo': 'Condo', 'Townhouse': 'Townhouse' };
const DAY = 86400000;

async function fetchAll(key, city, type, beds) {
  const pages = Math.min(5, Math.max(1, parseInt(process.env.LISTINGS_MAX_PAGES) || 1));
  let all = [];
  for (let i = 0; i < pages; i++) {
    const q = new URLSearchParams({ city, state: 'CA', status: 'Active', limit: '500', offset: String(i * 500) });
    if (type) q.set('propertyType', type);
    if (beds) q.set('bedrooms', `${beds}:*`);
    const r = await fetch('https://api.rentcast.io/v1/listings/sale?' + q, { headers: { 'X-Api-Key': key, accept: 'application/json' } });
    if (!r.ok) { if (i === 0) throw new Error('rentcast ' + r.status); break; }
    const page = await r.json();
    if (!Array.isArray(page)) break;
    all = all.concat(page);
    if (page.length < 500) break;
  }
  const now = Date.now(), seen = new Set();
  return all.filter(x => {
    if (!x.price || !x.formattedAddress || x.status !== 'Active' || x.removedDate) return false;
    if (x.lastSeenDate && now - Date.parse(x.lastSeenDate) > 3 * DAY) return false;
    const k = String(x.formattedAddress).toLowerCase(); if (seen.has(k)) return false; seen.add(k);
    return true;
  }).map(x => ({
    id: x.id, address: x.formattedAddress, line1: x.addressLine1 || String(x.formattedAddress).split(',')[0], city: x.city, zip: x.zipCode,
    price: x.price, beds: x.bedrooms, baths: x.bathrooms, sqft: x.squareFootage, lot: x.lotSize, year: x.yearBuilt, type: x.propertyType,
    dom: x.daysOnMarket, listed: x.listedDate, lat: x.latitude, lon: x.longitude, hoa: x.hoa && x.hoa.fee, lastSeen: x.lastSeenDate,
    office: x.listingOffice && x.listingOffice.name, mls: x.mlsNumber
  }));
}

export default async (req) => {
  const url = new URL(req.url);
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  const city = (url.searchParams.get('city') || '').trim().slice(0, 60);
  if (!/^[A-Za-z .'-]{2,60}$/.test(city)) return json({ error: 'invalid_city' }, 400);
  const beds = Math.min(10, Math.max(0, parseInt(url.searchParams.get('beds')) || 0));
  const baths = Math.min(10, Math.max(0, Math.floor(Number(url.searchParams.get('baths')) || 0)));
  const type = TYPES[url.searchParams.get('type')] || '';
  const ttl = Math.max(5, parseInt(process.env.LISTINGS_TTL_MIN) || 1440) * 60000;

  const cacheKey = [city.toLowerCase(), type || 'any', beds].join('|').replace(/[^a-z0-9|]/g, '_');
  let store = null, rec = null;
  try { store = getStore('listings-cache'); rec = await store.get(cacheKey, { type: 'json' }); } catch (_) {}
  if (!rec || !Array.isArray(rec.listings) || Date.now() - rec.at > ttl) {
    try {
      rec = { at: Date.now(), listings: await fetchAll(key, city, type, beds) };
      if (store) { try { await store.setJSON(cacheKey, rec); } catch (_) {} }
    } catch (_) {
      if (!rec) return json({ error: 'lookup_failed' }, 502);   // serve the last good copy if RentCast hiccups
    }
  }
  const listings = rec.listings.filter(l => !baths || l.baths == null || l.baths >= baths);
  return json({ city, asOf: new Date(rec.at).toISOString(), count: listings.length, listings }, 200, {
    'cache-control': 'public, max-age=300'
  });
};

export const config = { path: '/api/listings' };
