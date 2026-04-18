/**
 * GET  /api/tasks?leadId=X&limit=50  — list tasks (desc by sendAt)
 * DELETE /api/tasks?taskId=X         — cancel task + best-effort QStash delete
 */
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvPipeline(commands) {
  const url = kvUrl(), token = kvToken();
  if (!url) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(`${url}/pipeline`);
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function qstashDelete(messageId) {
  const token = process.env.QSTASH_TOKEN;
  if (!token || !messageId) return;
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'qstash.upstash.io', path: `/v2/messages/${messageId}`, method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, r => r.resume().on('end', resolve));
    req.on('error', resolve); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};

  if (req.method === 'GET') {
    const { leadId, limit = '50' } = q;
    const n = Math.min(parseInt(limit, 10) || 50, 200);
    const key = leadId ? `tasks:lead:${leadId}` : 'tasks:all';
    try {
      const rangeResult = await kvPipeline([['ZRANGE', key, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', '0', String(n)]]);
      const taskIds = rangeResult[0] && rangeResult[0].result;
      if (!taskIds || !taskIds.length) return res.status(200).json({ ok: true, tasks: [] });
      const gets = taskIds.map(id => ['GET', `task:${id}`]);
      const getResults = await kvPipeline(gets);
      const tasks = getResults
        .map(r => r && r.result)
        .filter(Boolean)
        .map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
        .filter(Boolean);
      return res.status(200).json({ ok: true, tasks });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const taskId = q.taskId || (req.url || '').split('?')[0].split('/').pop();
    if (!taskId || taskId === 'tasks') return res.status(400).json({ error: 'taskId query param required' });
    try {
      const getRes = await kvPipeline([['GET', `task:${taskId}`]]);
      const taskRaw = getRes[0] && getRes[0].result;
      if (!taskRaw) return res.status(404).json({ error: 'Task not found' });
      const task = typeof taskRaw === 'string' ? JSON.parse(taskRaw) : taskRaw;
      if (task.qstashMessageId) await qstashDelete(task.qstashMessageId);
      const updated = { ...task, status: 'cancelled', cancelledAt: new Date().toISOString() };
      await kvPipeline([['SET', `task:${taskId}`, JSON.stringify(updated)]]);
      return res.status(200).json({ ok: true, taskId, status: 'cancelled' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
