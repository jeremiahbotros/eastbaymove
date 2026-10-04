// Home value report for "Your Next Move".
// Calls the RentCast valuation API server-side (key never reaches the browser), then:
//  - keeps only truly comparable homes: within 1 mile, listed in the last 12 months,
//    ±1 bed, ±1 bath, ±20% living area, ±15 years built (widens to 1.5 mi / 18 months if needed)
//  - sets a conservative value: the lower of RentCast's estimate and the comps' median price per sq ft
// Setup: Netlify > Site configuration > Environment variables > RENTCAST_API_KEY.

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const median = a => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const round5k = n => Math.round(n / 5000) * 5000;

async function avm(key, address, radius, days) {
  const q = new URLSearchParams({ address, compCount: '25', maxRadius: String(radius), daysOld: String(days) });
  const r = await fetch('https://api.rentcast.io/v1/avm/value?' + q, { headers: { 'X-Api-Key': key, accept: 'application/json' } });
  if (!r.ok) return { error: r.status };
  return { data: await r.json() };
}

function pickComps(d, sp, radius, days, sqftPct, yearSpan) {
  return (d.comparables || []).filter(c => {
    if (!c.price || (c.distance != null && c.distance > radius) || (c.daysOld != null && c.daysOld > days)) return false;
    if (sp.bedrooms != null && c.bedrooms != null && Math.abs(c.bedrooms - sp.bedrooms) > 1) return false;
    if (sp.bathrooms != null && c.bathrooms != null && Math.abs(c.bathrooms - sp.bathrooms) > 1) return false;
    if (sp.squareFootage && c.squareFootage && Math.abs(c.squareFootage - sp.squareFootage) / sp.squareFootage > sqftPct) return false;
    if (sp.yearBuilt && c.yearBuilt && Math.abs(c.yearBuilt - sp.yearBuilt) > yearSpan) return false;
    if (sp.propertyType && c.propertyType && sp.propertyType !== c.propertyType) return false;
    return true;
  }).sort((a, b) => (b.correlation || 0) - (a.correlation || 0));
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

  let res, comps = [], tier = 'strict';
  try {
    res = await avm(key, address, 1, 365);
    if (res.data) comps = pickComps(res.data, res.data.subjectProperty || {}, 1, 365, 0.20, 15);
    if (!res.data || comps.length < 3) {
      const wide = await avm(key, address, 1.5, 540);
      if (wide.data) {
        const c2 = pickComps(wide.data, wide.data.subjectProperty || {}, 1.5, 540, 0.25, 20);
        if (!res.data || c2.length > comps.length) { res = wide; comps = c2; tier = 'widened'; }
      }
    }
  } catch (_) { return json({ error: 'lookup_failed' }, 502); }
  if (!res || !res.data) return json({ error: 'lookup_failed', status: res && res.error }, res && res.error === 404 ? 404 : 502);

  const d = res.data, sp = d.subjectProperty || {};
  const top = comps.slice(0, 6);
  const ppsf = top.filter(c => c.squareFootage).map(c => c.price / c.squareFootage);
  const compValue = sp.squareFootage && ppsf.length >= 2 ? median(ppsf) * sp.squareFootage : 0;
  // Conservative: never above RentCast's estimate; pulled down to the comps when they say lower.
  const value = round5k(compValue ? Math.min(d.price, compValue) : d.price);
  const low = round5k(Math.min(d.priceRangeLow || value * 0.95, value * 0.95));
  const high = round5k(Math.max(value * 1.04, Math.min(d.priceRangeHigh || value * 1.06, value * 1.08)));

  return json({
    value, low, high, avm: d.price, method: compValue && compValue < d.price ? 'comps' : 'avm', compTier: tier,
    beds: sp.bedrooms, baths: sp.bathrooms, sqft: sp.squareFootage, lot: sp.lotSize, yearBuilt: sp.yearBuilt,
    propertyType: sp.propertyType, lastSalePrice: sp.lastSalePrice, lastSaleDate: sp.lastSaleDate, city: sp.city, zip: sp.zipCode,
    comps: top.map(c => ({
      address: c.formattedAddress, price: c.price, sqft: c.squareFootage, beds: c.bedrooms, baths: c.bathrooms, year: c.yearBuilt,
      distance: c.distance, daysOld: c.daysOld, status: c.status, listed: c.listedDate, removed: c.removedDate
    }))
  }, 200, {
    'cache-control': 'public, max-age=3600',
    'netlify-cdn-cache-control': 'public, durable, s-maxage=2592000'
  });
};

export const config = { path: '/api/home-value' };
