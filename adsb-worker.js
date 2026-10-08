// ADS-B relay for Jump Master Expert Tool, run as a Cloudflare Worker.
// The app asks for aircraft near a point; this fetches them from a free feed (adsb.fi, falling back to adsb.lol)
// and passes them back as {ac:[...]} with the permission header browsers need. Only the app's own site may use it.
const ALLOWED = ['https://ojmbycd.github.io'];
const FEEDS = [
  (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const u = new URL(req.url);
    const lat = parseFloat(u.searchParams.get('lat'));
    const lon = parseFloat(u.searchParams.get('lon'));
    const r = Math.round(Math.min(250, Math.max(1, parseFloat(u.searchParams.get('r')) || 60))); // nautical miles
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return new Response(JSON.stringify({ error: 'lat and lon needed' }), { status: 400, headers: cors });
    }

    let last = 'no feed answered';
    for (const feed of FEEDS) {
      try {
        const up = await fetch(feed(lat.toFixed(3), lon.toFixed(3), r), { headers: { 'User-Agent': 'JumpMasterExpertTool/1.0' } });
        if (!up.ok) { last = `${new URL(feed(0, 0, 1)).host} ${up.status}`; continue; }
        const j = await up.json();
        return new Response(JSON.stringify({ ac: j.ac || j.aircraft || [], src: new URL(feed(0, 0, 1)).host }), { headers: cors });
      } catch (e) { last = String(e); }
    }
    return new Response(JSON.stringify({ error: last }), { status: 502, headers: cors });
  },
};
