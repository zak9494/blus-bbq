/**
 * POST /api/schedule
 * Body: { leadId?, channel, sendAt (ISO), payload: { to, name, subject, body } }
 * Stores task in Upstash KV + enqueues QStash callback to /api/dispatch/<channel>
 */
const https = require('https');

const APP_URL = process.env.APP_URL || 'https://blus-bbq.vercel.app';

function kvUrl()    { return process.env.KV_REST_API_URL    || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken()  { return process.env.KV_REST_API_TOKEN  || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvExec(commands) {
  // Upstash Redis REST API - pipeline
  const url = kvUrl();
  const token = kvToken();
  if (!url || !token) throw new Error('KV env vars not set (KV_REST_API_URL / KV_REST_API_TOKEN)');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(`${url}/pipeline`);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function qstashPublish(destUrl, body, delaySeconds) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN not set');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const path = `/v2/publish/${encodeURIComponent(destUrl)}`;
    const opts = {
      hostname: 'qstash.upstash.io', path, method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Upstash-Delay': `${Math.max(0, delaySeconds)}s`,
        'Upstash-Retries': '3',
      },
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { leadId, channel = 'email', sendAt, payload } = req.body || {};
  if (!sendAt) return res.status(400).json({ error: 'sendAt (ISO string) required' });
  if (!payload || !payload.to) return res.status(400).json({ error: 'payload.to required' });

  const sendAtMs = new Date(sendAt).getTime();
  if (isNaN(sendAtMs)) return res.status(400).json({ error: 'sendAt must be a valid date' });
  const delaySeconds = Math.max(0, Math.floor((sendAtMs - Date.now()) / 1000));

  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dispatchUrl = `${APP_URL}/api/dispatch/${channel}`;

  try {
    const qr = await qstashPublish(dispatchUrl, { taskId, leadId, channel, payload }, delaySeconds);
    if (qr.status >= 300) {
      return res.status(502).json({ error: 'QStash enqueue failed', detail: qr.body });
    }
    const qstashMessageId = qr.body && qr.body.messageId;

    const task = {
      taskId, leadId: leadId || null, channel, sendAt, payload,
      status: 'scheduled', createdAt: new Date().toISOString(),
      qstashMessageId: qstashMessageId || null,
    };
    const score = sendAtMs;
    const taskJson = JSON.stringify(task);
    const cmds = [
      ['SET', `task:${taskId}`, taskJson],
      ['ZADD', 'tasks:all', score, taskId],
    ];
    if (leadId) cmds.push(['ZADD', `tasks:lead:${leadId}`, score, taskId]);
    await kvExec(cmds);

    return res.status(200).json({ ok: true, taskId, qstashMessageId, sendAt, delaySeconds });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
