// ADS-B relay for Jump Master Expert Tool, run as a Cloudflare Worker.
// The app asks for aircraft near a point; this fetches them from the free adsb.lol feed
// and passes them back with the permission header browsers need. Only the app's own site may use it.
const ALLOWED = ['https://ojmbycd.github.io'];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const u = new URL(req.url);
    const lat = parseFloat(u.searchParams.get('lat'));
    const lon = parseFloat(u.searchParams.get('lon'));
    const r = Math.min(250, Math.max(1, parseFloat(u.searchParams.get('r')) || 60)); // nautical miles
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return new Response(JSON.stringify({ error: 'lat and lon needed' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const up = await fetch(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(r)}`, {
      headers: { 'User-Agent': 'JumpMasterExpertTool/1.0' },
    });
    return new Response(up.body, { status: up.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
