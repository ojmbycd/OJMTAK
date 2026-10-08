// ADS-B relay for Jump Master Expert Tool, run as a Cloudflare Worker.
// The app asks for aircraft near a point. This fetches them from OpenSky Network (using the account's API client,
// stored as the Worker secrets OPENSKY_ID and OPENSKY_SECRET), falling back to adsb.fi and adsb.lol, and returns
// {ac:[...]} in one format with the permission header browsers need. Only the app's own site may use it.
const ALLOWED = ['https://ojmbycd.github.io'];
const FT = 0.3048, KT = 0.514444;
let token = null, tokenExp = 0;

async function openskyToken(env) {
  if (token && Date.now() < tokenExp) return token;
  const r = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_ID, client_secret: env.OPENSKY_SECRET }),
  });
  if (!r.ok) throw new Error(`OpenSky login ${r.status}`);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + ((j.expires_in || 1800) - 60) * 1000;
  return token;
}

async function opensky(env, lat, lon, nm) {
  if (!env.OPENSKY_ID || !env.OPENSKY_SECRET) throw new Error('OpenSky secrets not set');
  const dLat = nm / 60, dLon = nm / (60 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const q = new URLSearchParams({ lamin: (lat - dLat).toFixed(3), lamax: (lat + dLat).toFixed(3), lomin: (lon - dLon).toFixed(3), lomax: (lon + dLon).toFixed(3) });
  const r = await fetch(`https://opensky-network.org/api/states/all?${q}`, { headers: { Authorization: `Bearer ${await openskyToken(env)}` } });
  if (!r.ok) throw new Error(`OpenSky ${r.status}`);
  const j = await r.json(), now = j.time || Date.now() / 1000;
  // state vector: 0 icao24, 1 callsign, 3 time_position, 5 lon, 6 lat, 7 baro alt m, 8 on ground, 9 speed m/s, 10 track, 13 geo alt m
  return (j.states || []).filter(s => s[5] != null && s[6] != null).map(s => ({
    hex: s[0], flight: (s[1] || '').trim(), lat: s[6], lon: s[5],
    alt_baro: s[8] ? 'ground' : s[7] != null ? Math.round(s[7] / FT) : null,
    alt_geom: s[13] != null ? Math.round(s[13] / FT) : undefined,
    gs: s[9] != null ? s[9] / KT : 0, track: s[10] || 0, seen_pos: s[3] ? Math.max(0, now - s[3]) : null,
  }));
}

async function readsb(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'JumpMasterExpertTool/1.0' } });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  const j = await r.json();
  return j.ac || j.aircraft || [];
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const u = new URL(req.url);
    const lat = parseFloat(u.searchParams.get('lat')), lon = parseFloat(u.searchParams.get('lon'));
    const nm = Math.round(Math.min(150, Math.max(1, parseFloat(u.searchParams.get('r')) || 40)));
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return new Response(JSON.stringify({ error: 'lat and lon needed' }), { status: 400, headers: cors });
    }

    const feeds = [
      ['opensky', () => opensky(env, lat, lon, nm)],
      ['adsb.fi', () => readsb(`https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${nm}`)],
      ['adsb.lol', () => readsb(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${nm}`)],
    ];
    const errors = [];
    for (const [src, get] of feeds) {
      try { return new Response(JSON.stringify({ ac: await get(), src }), { headers: cors }); }
      catch (e) { errors.push(String(e.message || e)); }
    }
    return new Response(JSON.stringify({ error: errors.join('; ') }), { status: 502, headers: cors });
  },
};
