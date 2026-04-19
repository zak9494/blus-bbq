/**
 * GET /api/modify-phases  — returns median ms per phase for ETA display
 * POST /api/modify-phases — records a completed phase duration to KV
 *   body: { phase: string, durationMs: number }
 * Stores last 10 durations per phase in KV key: modify:phases
 */
const https = require('https');
const MAX_SAMPLES = 10;
const PHASES = ['read_source', 'ai_generate', 'preview', 'apply'];

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return null;
  return new Promise((resolve) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + token } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return;
  return new Promise((resolve) => {
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url + '/pipeline');
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = await kvGet('modify:phases');
  const phaseData = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};

  // GET: return medians for each phase + total ETA
  if (req.method === 'GET') {
    const medians = {};
    let totalMs = 0;
    for (const phase of PHASES) {
      const med = median(phaseData[phase] || []);
      medians[phase] = med;
      if (med) totalMs += med;
    }
    return res.status(200).json({ ok: true, medians, totalMs: totalMs || null, sampleCounts: Object.fromEntries(PHASES.map(p => [p, (phaseData[p] || []).length])) });
  }

  // POST: record a phase duration
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const { phase, durationMs } = body;
  if (!phase || !PHASES.includes(phase)) return res.status(400).json({ error: 'phase must be one of: ' + PHASES.join(', ') });
  if (typeof durationMs !== 'number' || durationMs <= 0) return res.status(400).json({ error: 'durationMs must be a positive number' });

  const samples = phaseData[phase] || [];
  samples.push(Math.round(durationMs));
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  phaseData[phase] = samples;

  await kvSet('modify:phases', JSON.stringify(phaseData));
  return res.status(200).json({ ok: true, phase, durationMs: Math.round(durationMs), sampleCount: samples.length, median: median(samples) });
};
