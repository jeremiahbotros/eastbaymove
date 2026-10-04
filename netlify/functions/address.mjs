// Address suggestions for "Your Next Move" (Google Places API, New).
// Keeps the Google key server-side. Setup: Netlify > Site configuration > Environment variables >
// add GOOGLE_MAPS_API_KEY (a key with "Places API (New)" enabled).
//   GET /api/address?q=125 arezzo&session=abc       -> { suggestions:[{ label, placeId }] }
//   GET /api/address?placeId=XYZ&session=abc        -> { label, street, city, zip }

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

// Bay Area plus a little margin (Tracy, Delta, Santa Cruz Mountains).
const BOUNDS = { rectangle: { low: { latitude: 36.85, longitude: -123.65 }, high: { latitude: 38.9, longitude: -121.2 } } };

export default async (req) => {
  const url = new URL(req.url);
  const allowed = (process.env.ALLOWED_HOSTS || 'eastbaymove.netlify.app').split(',').map(s => s.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(req.headers.get('referer') || req.headers.get('origin') || '').hostname; } catch (_) {}
  if (host && !allowed.includes(host) && !host.endsWith('--' + allowed[0]) && host !== 'localhost') return json({ error: 'forbidden' }, 403);

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);
  const session = (url.searchParams.get('session') || '').slice(0, 64);
  const placeId = url.searchParams.get('placeId');

  try {
    if (placeId) {
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + (session ? '?sessionToken=' + encodeURIComponent(session) : ''), {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'formattedAddress,addressComponents' }
      });
      if (!r.ok) return json({ error: 'details_failed' }, 502);
      const d = await r.json();
      const comp = t => ((d.addressComponents || []).find(c => (c.types || []).includes(t)) || {});
      const street = [comp('street_number').longText, comp('route').shortText].filter(Boolean).join(' ');
      const city = comp('locality').longText || comp('sublocality').longText || comp('neighborhood').longText || '';
      const zip = comp('postal_code').longText || '';
      const unit = comp('subpremise').longText;
      const label = [street + (unit ? ' #' + unit : ''), city, ['CA', zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      return json({ label: label || (d.formattedAddress || '').replace(/, USA$/, ''), street, city, zip });
    }

    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3 || q.length > 120) return json({ suggestions: [] });
    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({
        input: q, sessionToken: session || undefined,
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        includedRegionCodes: ['us'], locationRestriction: BOUNDS, languageCode: 'en'
      })
    });
    if (!r.ok) return json({ error: 'autocomplete_failed' }, 502);
    const d = await r.json();
    const suggestions = (d.suggestions || []).map(s => s.placePrediction).filter(Boolean).map(p => ({
      placeId: p.placeId,
      label: ((p.text && p.text.text) || '').replace(/, USA$/, '')
    })).filter(s => s.placeId && s.label).slice(0, 6);
    return json({ suggestions });
  } catch (_) {
    return json({ error: 'lookup_failed' }, 502);
  }
};

export const config = { path: '/api/address' };
