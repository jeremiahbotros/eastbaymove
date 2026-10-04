// Active for-sale listings for the "Your Next Move" plan page (RentCast /listings/sale).
// Uses the same RENTCAST_API_KEY. Each search is cached on Netlify's CDN for 12 hours
// so repeat visits don't use extra lookups.
//   GET /api/listings?city=Brentwood&max=1200000&beds=3&baths=2&type=Single Family Home
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const TYPES = { 'Single Family Home': 'Single Family', 'Condo': 'Condo', 'Townhouse': 'Townhouse' };

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
  const max = Math.min(50000000, Math.max(100000, Math.round(Number(url.searchParams.get('max')) / 50000) * 50000 || 1000000));
  const beds = Math.min(10, Math.max(0, parseInt(url.searchParams.get('beds')) || 0));
  const baths = Math.min(10, Math.max(0, Math.floor(Number(url.searchParams.get('baths')) || 0)));
  const type = TYPES[url.searchParams.get('type')] || '';

  const q = new URLSearchParams({ city, state: 'CA', status: 'Active', price: `100000:${max}`, limit: '24' });
  if (beds) q.set('bedrooms', `${beds}:*`);
  if (baths) q.set('bathrooms', `${baths}:*`);
  if (type) q.set('propertyType', type);

  let r;
  try { r = await fetch('https://api.rentcast.io/v1/listings/sale?' + q, { headers: { 'X-Api-Key': key, accept: 'application/json' } }); }
  catch (_) { return json({ error: 'lookup_failed' }, 502); }
  if (!r.ok) return json({ error: 'lookup_failed', status: r.status }, 502);
  const list = await r.json();
  const listings = (Array.isArray(list) ? list : []).filter(x => x.price && x.formattedAddress).map(x => ({
    id: x.id, address: x.formattedAddress, line1: x.addressLine1 || String(x.formattedAddress).split(',')[0], city: x.city, zip: x.zipCode,
    price: x.price, beds: x.bedrooms, baths: x.bathrooms, sqft: x.squareFootage, lot: x.lotSize, year: x.yearBuilt, type: x.propertyType,
    dom: x.daysOnMarket, listed: x.listedDate, lat: x.latitude, lon: x.longitude, hoa: x.hoa && x.hoa.fee,
    office: x.listingOffice && x.listingOffice.name, mls: x.mlsNumber
  }));
  return json({ city, max, listings }, 200, {
    'cache-control': 'public, max-age=1800',
    'netlify-cdn-cache-control': 'public, durable, s-maxage=43200'
  });
};

export const config = { path: '/api/listings' };
