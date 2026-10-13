// Home value report for "Your Next Move" — built like an agent CMA.
// 1) RentCast AVM call: identifies the subject home (beds, baths, size, year, location).
// 2) RentCast property-records search: every RECORDED SALE within 1 mile in the last 18 months
//    (real closed prices from county records, not asking prices).
// 3) Picks the closest true comparables first — same street / same tract first — then:
//      similar size (±30%), ±1 bed, ±25 yrs built, same property type; drops $/sq ft outliers.
// 4) Adjusts each sale for size at 25% of its $/sq ft, weights the closest and most recent
//    sales most, and rounds to the nearest $5,000.
// Falls back to the AVM's listing comps only if fewer than 3 recorded sales qualify.
// Setup: Netlify > Site configuration > Environment variables > RENTCAST_API_KEY.
// Cost: 2 RentCast lookups per NEW address, only when a visitor enters it. Each address is saved for
// 30 days, so repeat visits, refreshes and plan links never look it up again.

import { getStore } from '@netlify/blobs';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const median = a => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const round5k = n => Math.round(n / 5000) * 5000;
const floor5k = n => Math.floor(n / 5000) * 5000;
const DAY = 86400000;
// Size differences are adjusted at 25% of the comp's price per sq ft (about $70–$100/sq ft in most
// East Bay tracts) — the extra square feet in a bigger model don't add value one-for-one.
const SIZE_WEIGHT = 0.25;
const H = { accept: 'application/json' };

function miles(a, b, c, d) {
  const R = 3958.8, r = x => x * Math.PI / 180;
  const dLat = r(c - a), dLon = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const streetOf = a => String(a || '').split(',')[0].replace(/^\d+[A-Za-z]?\s+/, '').toLowerCase().trim();
const norm = a => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function rc(key, path, params) {
  const r = await fetch('https://api.rentcast.io/v1/' + path + '?' + new URLSearchParams(params), { headers: { ...H, 'X-Api-Key': key } });
  if (!r.ok) return { error: r.status };
  return { data: await r.json() };
}

// Recorded sales near the subject, scored like an agent would pick them.
export function pickSales(records, sp, lat, lon, now = Date.now()) {
  const subjStreet = streetOf(sp.formattedAddress || sp.addressLine1);
  const out = [];
  for (const x of Array.isArray(records) ? records : []) {
    const price = x.lastSalePrice, when = Date.parse(x.lastSaleDate || '');
    if (!price || price < 75000 || !when) continue;
    if (norm(x.formattedAddress) === norm(sp.formattedAddress)) continue;
    const days = Math.round((now - when) / DAY);
    if (days < 0 || days > 548) continue;
    if (sp.propertyType && x.propertyType && sp.propertyType !== x.propertyType) continue;
    if (sp.squareFootage && x.squareFootage && Math.abs(x.squareFootage - sp.squareFootage) / sp.squareFootage > 0.30) continue;
    if (sp.bedrooms != null && x.bedrooms != null && Math.abs(x.bedrooms - sp.bedrooms) > 1) continue;
    if (sp.yearBuilt && x.yearBuilt && Math.abs(x.yearBuilt - sp.yearBuilt) > 25) continue;
    const dist = (lat != null && x.latitude != null) ? miles(lat, lon, x.latitude, x.longitude) : 0.5;
    if (dist > 1) continue;
    const sameStreet = subjStreet && streetOf(x.formattedAddress) === subjStreet;
    const score = dist / 0.15                                     // every 0.15 mile counts as 1
      + days / 365                                                // every year counts as 1
      + (sp.squareFootage && x.squareFootage ? Math.abs(x.squareFootage - sp.squareFootage) / sp.squareFootage * 6 : 0.6)
      + (sp.bedrooms != null && x.bedrooms != null ? Math.abs(x.bedrooms - sp.bedrooms) * 0.4 : 0)
      + (sp.yearBuilt && x.yearBuilt ? Math.abs(x.yearBuilt - sp.yearBuilt) / 8 : 0.4)
      - (sameStreet ? 0.6 : 0);
    out.push({ x, price, days, dist, score, sameStreet });
  }
  // drop $/sq ft outliers (remodels, distressed sales, data errors)
  const ppsf = out.filter(c => c.x.squareFootage).map(c => c.price / c.x.squareFootage);
  const mid = median(ppsf);
  const kept = mid ? out.filter(c => !c.x.squareFootage || Math.abs(c.price / c.x.squareFootage - mid) / mid <= 0.25) : out;
  return kept.sort((a, b) => a.score - b.score);
}

export function valueFromSales(top, sp) {
  const adj = top.map(c => {
    const sq = c.x.squareFootage, a = (sp.squareFootage && sq) ? c.price + (sp.squareFootage - sq) * (c.price / sq) * SIZE_WEIGHT : c.price;
    return { a, w: 1 / (1 + c.score) };
  });
  const wsum = adj.reduce((s, v) => s + v.w, 0);
  const wavg = adj.reduce((s, v) => s + v.a * v.w, 0) / wsum;
  const med = median(adj.map(v => v.a));
  // weighted toward the closest, most similar sales; median guards against one odd sale
  const base = Math.abs(wavg - med) / med > 0.04 ? med : wavg;
  return { value: round5k(base), adjusted: adj.map(v => Math.round(v.a)) };
}

function pickListingComps(d, sp) {
  return (d.comparables || []).filter(c => {
    if (!c.price || (c.distance != null && c.distance > 1.5) || (c.daysOld != null && c.daysOld > 540)) return false;
    if (sp.bedrooms != null && c.bedrooms != null && Math.abs(c.bedrooms - sp.bedrooms) > 1) return false;
    if (sp.squareFootage && c.squareFootage && Math.abs(c.squareFootage - sp.squareFootage) / sp.squareFootage > 0.25) return false;
    if (sp.propertyType && c.propertyType && sp.propertyType !== c.propertyType) return false;
    return true;
  }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
}

export default async (req) => {
  const url = new URL(req.url);
  const address = (url.searchParams.get('address') || '').trim();
  if (address.length < 8 || address.length > 200) return json({ error: 'invalid_address' }, 400);

  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);

  const key = process.env.RENTCAST_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  const HDR = { 'cache-control': 'public, max-age=3600', 'netlify-cdn-cache-control': 'public, durable, s-maxage=2592000' };
  const ck = 'v2-' + address.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 150);
  let cache = null;
  try { cache = getStore('home-values'); const hit = await cache.get(ck, { type: 'json' }); if (hit && Date.now() - hit.at < 30 * DAY) return json(hit.body, 200, HDR); } catch (_) { cache = null; }

  let res;
  try { res = await rc(key, 'avm/value', { address, compCount: '25', maxRadius: '1', daysOld: '540' }); }
  catch (_) { return json({ error: 'lookup_failed' }, 502); }
  if (!res.data) return json({ error: 'lookup_failed', status: res.error }, res.error === 404 ? 404 : 502);
  const d = res.data, sp = Object.assign({ formattedAddress: address }, d.subjectProperty || {});
  const lat = sp.latitude != null ? sp.latitude : d.latitude, lon = sp.longitude != null ? sp.longitude : d.longitude;

  // Recorded sales within a mile, last 18 months
  let sales = [];
  if (lat != null && lon != null) {
    try {
      const p = { latitude: String(lat), longitude: String(lon), radius: '1', saleDateRange: '548', limit: '500' };
      if (sp.propertyType) p.propertyType = sp.propertyType;
      const s = await rc(key, 'properties', p);
      if (s.data) sales = pickSales(s.data, sp, lat, lon);
    } catch (_) {}
  }

  let value, low, high, comps, method, compValue = 0;
  if (sales.length >= 3) {
    const top = sales.slice(0, 6);
    // Same-neighborhood sales (within ~0.2 mi) win outright when there are at least 3 of them.
    const near = sales.filter(c => c.dist <= 0.2);
    const r = valueFromSales(near.length >= 3 ? near.slice(0, 4) : top.slice(0, 4), sp);
    value = r.value; compValue = value; method = 'recorded-sales';
    const adjSorted = r.adjusted.slice().sort((a, b) => a - b);
    low = floor5k(Math.max(Math.min(adjSorted[0], value * 0.96), value * 0.92));
    high = round5k(Math.min(Math.max(adjSorted[adjSorted.length - 1], value * 1.03), value * 1.08));
    comps = top.map(c => ({
      address: c.x.formattedAddress, price: c.price, sqft: c.x.squareFootage, beds: c.x.bedrooms, baths: c.x.bathrooms, year: c.x.yearBuilt,
      distance: Math.round(c.dist * 100) / 100, daysOld: c.days, status: 'Sold', sold: String(c.x.lastSaleDate).slice(0, 10), sameStreet: c.sameStreet
    }));
  } else {
    // Fallback: listings that left the market (likely sold), then asking prices shaded 3%.
    const lc = pickListingComps(d, sp);
    const closed = lc.filter(c => c.status === 'Inactive');
    let pool = (closed.length >= 3 ? closed : lc).map(c => Object.assign({}, c, { adjPrice: c.status === 'Active' ? c.price * 0.97 : c.price })).slice(0, 6);
    const adj = pool.filter(c => c.squareFootage && sp.squareFootage).map(c => c.adjPrice + (sp.squareFootage - c.squareFootage) * (c.adjPrice / c.squareFootage) * SIZE_WEIGHT);
    compValue = adj.length >= 2 ? median(adj) : 0;
    value = floor5k(compValue ? Math.min(d.price, compValue) : d.price * 0.97);
    low = round5k(value * 0.95); high = round5k(value * 1.04); method = 'listing-comps';
    comps = pool.map(c => ({
      address: c.formattedAddress, price: c.price, sqft: c.squareFootage, beds: c.bedrooms, baths: c.bathrooms, year: c.yearBuilt,
      distance: c.distance, daysOld: c.daysOld, status: c.status, listed: c.listedDate, removed: c.removedDate
    }));
  }
  // Nearby active listings = the competition (shown for context, not used in the value)
  const active = (d.comparables || []).filter(c => c.status === 'Active' && c.price && (c.distance == null || c.distance <= 0.75))
    .sort((a, b) => (a.distance || 0) - (b.distance || 0)).slice(0, 3)
    .map(c => ({ address: c.formattedAddress, price: c.price, sqft: c.squareFootage, beds: c.bedrooms, baths: c.bathrooms, year: c.yearBuilt, distance: c.distance, daysOld: c.daysOld, status: 'Active' }));

  const body = {
    value, low, high, avm: d.price, compValue: Math.round(compValue), method, salesFound: sales.length,
    beds: sp.bedrooms, baths: sp.bathrooms, sqft: sp.squareFootage, lot: sp.lotSize, yearBuilt: sp.yearBuilt,
    propertyType: sp.propertyType, lastSalePrice: sp.lastSalePrice, lastSaleDate: sp.lastSaleDate, city: sp.city, zip: sp.zipCode,
    comps, active
  };
  if (cache) { try { await cache.setJSON(ck, { at: Date.now(), body }); } catch (_) {} }
  return json(body, 200, HDR);
};

export const config = { path: '/api/home-value' };
