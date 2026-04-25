'use strict';
/* ===== MAPS: Distance + Drive Time Proxy
   GET /api/maps/distance?destination=...&departAt=...
   Returns { ok, miles, freeFlowMin, trafficMin, origin }
   Requires MAPBOX_TOKEN env var. Origin address read from KV via getShopOriginAddress().
   Returns { ok: false, error: 'no_origin_address' } when address is not configured.
   Gated by maps_v1 flag.
   ===== */
const https = require('https');
const { getFlag } = require('../_lib/flags.js');
const { getShopOriginAddress } = require('../_lib/shop-origin.js');

const MAPBOX_BASE = 'https://api.mapbox.com';

// Module-level cache: geocode results live for the process lifetime
const _geocodeCache = new Map();

function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs || 5000);
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function geocode(address, token) {
  if (_geocodeCache.has(address)) return _geocodeCache.get(address);
  const url = `${MAPBOX_BASE}/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`
    + `?access_token=${token}&limit=1&country=US`;
  const data = await httpsGet(url, 4000);
  const feature = data.features && data.features[0];
  if (!feature) throw new Error('geocode_not_found');
  const [lng, lat] = feature.center;
  const coords = { lng, lat };
  _geocodeCache.set(address, coords);
  return coords;
}

async function getDirections(originCoords, destCoords, profile, token, departAt) {
  const coords = `${originCoords.lng},${originCoords.lat};${destCoords.lng},${destCoords.lat}`;
  let url = `${MAPBOX_BASE}/directions/v5/${profile}/${coords}`
    + `?access_token=${token}&overview=false&geometries=geojson`;
  if (departAt && profile === 'mapbox/driving-traffic') {
    url += '&depart_at=' + encodeURIComponent(departAt);
  }
  const data = await httpsGet(url, 5000);
  const route = data.routes && data.routes[0];
  if (!route) throw new Error('no_route');
  return {
    miles: route.distance / 1609.344,
    minutes: Math.round(route.duration / 60),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=900');

  try {
    const enabled = await getFlag('maps_v1');
    if (!enabled) {
      return res.status(200).json({ ok: false, error: 'disabled' });
    }

    const token = process.env.MAPBOX_TOKEN;
    if (!token) {
      return res.status(200).json({ ok: false, error: 'no_token' });
    }

    const originAddr = await getShopOriginAddress();
    if (!originAddr) {
      return res.status(200).json({ ok: false, error: 'no_origin_address' });
    }

    const { destination, departAt } = req.query;
    if (!destination) {
      return res.status(400).json({ ok: false, error: 'missing_destination' });
    }

    // Bucket departAt to 15-min intervals for consistent caching at call site
    let bucketedDepartAt = null;
    if (departAt) {
      try {
        const d = new Date(departAt);
        d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
        bucketedDepartAt = d.toISOString();
      } catch (_) { /* ignore invalid date */ }
    }

    const [originCoords, destCoords] = await Promise.all([
      geocode(originAddr, token),
      geocode(destination, token),
    ]);

    const [freeFlow, traffic] = await Promise.all([
      getDirections(originCoords, destCoords, 'mapbox/driving', token, null),
      getDirections(originCoords, destCoords, 'mapbox/driving-traffic', token, bucketedDepartAt),
    ]);

    return res.status(200).json({
      ok: true,
      miles: Math.round(freeFlow.miles * 10) / 10,
      freeFlowMin: freeFlow.minutes,
      trafficMin: traffic.minutes,
      origin: originAddr,
    });

  } catch (err) {
    console.error('[maps/distance] error:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
