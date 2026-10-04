// Home value report for "Your Next Move".
// Calls the RentCast valuation API (AVM) server-side so the API key never reaches the browser.
// Setup: Netlify > Site configuration > Environment variables > add RENTCAST_API_KEY.
// Optional: ALLOWED_HOSTS (comma-separated), defaults to eastbaymove.netlify.app.

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

export default async (req) => {
  const url = new URL(req.url);
  const address = (url.searchParams.get('address') || '').trim();
  if (address.length < 8 || address.length > 200) return json({ error: 'invalid_address' }, 400);

  // Only answer requests coming from your own site (keeps others from using up your lookups).
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  const from = req.headers.get('referer') || req.headers.get('origin') || '';
  let host = '';
  try { host = new URL(from).hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);

  const key = process.env.RENTCAST_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  let r;
  try {
    r = await fetch('https://api.rentcast.io/v1/avm/value?' + new URLSearchParams({ address, compCount: '5' }), {
      headers: { 'X-Api-Key': key, accept: 'application/json' }
    });
  } catch (_) { return json({ error: 'lookup_failed' }, 502); }
  if (!r.ok) return json({ error: 'lookup_failed', status: r.status }, r.status === 404 ? 404 : 502);

  const d = await r.json();
  const sp = d.subjectProperty || {};
  return json({
    value: d.price, low: d.priceRangeLow, high: d.priceRangeHigh,
    beds: sp.bedrooms, baths: sp.bathrooms, sqft: sp.squareFootage, lot: sp.lotSize, yearBuilt: sp.yearBuilt,
    propertyType: sp.propertyType, lastSalePrice: sp.lastSalePrice, lastSaleDate: sp.lastSaleDate,
    city: sp.city, zip: sp.zipCode,
    comps: (d.comparables || []).slice(0, 5).map(c => ({
      address: c.formattedAddress, price: c.price, sqft: c.squareFootage, beds: c.bedrooms, baths: c.bathrooms, distance: c.distance
    }))
  }, 200, {
    // Cache each address for 30 days on Netlify's CDN so repeat lookups don't use extra API calls.
    'cache-control': 'public, max-age=3600',
    'netlify-cdn-cache-control': 'public, durable, s-maxage=2592000'
  });
};

export const config = { path: '/api/home-value' };
