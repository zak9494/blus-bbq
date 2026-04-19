/**
 * GET /api/inquiries/cleanup  — one-shot, secret-gated KV pruning
 * Deletes non-Wix inquiry records and rebuilds the index sorted by email_date.
 * TEMPORARY — delete after use.
 */
module.exports.config = { maxDuration: 30 };
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + token } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvPipeline(cmds) {
  const url = kvUrl(), token = kvToken();
  const body = JSON.stringify(cmds);
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const NON_WIX = [
  '19d8c82408ef549a','19d8d4cd94f20dcb','19d91431a4507d89','19d96f011e269017',
  '19d975d18757ff31','19d8c9e8f7232079','19d8d42b61abbc0a','19d9834c31c54c61',
  '19d9c033ed198de3','19d8c79f236b2872','19d9c3af80b5f32d','19d9cd0eed023a91',
  '19cb4a4b7680725b','19da2a379d7b5df7','19da6a8f044055c3',
];
const KEEP = ['19d8d31d0018f195','19d9736c511ab148','19d98246be681317','19d9c2da1e350fed','19da65a08f8a1842'];

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  // Step 1: Delete non-Wix records
  const delCmds = NON_WIX.map(id => ['DEL', 'inquiries:' + id]);
  const delResult = await kvPipeline(delCmds);

  // Step 2: Fetch kept records and build sorted index
  const newIndex = [];
  for (const id of KEEP) {
    const raw = await kvGet('inquiries:' + id);
    if (!raw) continue;
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ef = rec.extracted_fields || {};
    newIndex.push({
      threadId:     id,
      from:         rec.from || '',
      subject:      rec.subject || '',
      customer_name: ef.customer_name || null,
      event_date:   ef.event_date   || null,
      guest_count:  ef.guest_count  || null,
      status:       rec.status || 'new',
      email_date:   rec.date   || null,
      updated_at:   rec.updated_at || '',
    });
  }

  // Sort by email_date descending (newest first), nulls last
  newIndex.sort((a, b) => {
    const da = a.email_date ? new Date(a.email_date).getTime() : 0;
    const db = b.email_date ? new Date(b.email_date).getTime() : 0;
    return db - da;
  });

  // Also load test record and append
  const testRaw = await kvGet('inquiries:test-thread-bob-billy-001');
  if (testRaw) {
    const tr = typeof testRaw === 'string' ? JSON.parse(testRaw) : testRaw;
    const ef = tr.extracted_fields || {};
    newIndex.push({
      threadId: 'test-thread-bob-billy-001',
      from: tr.from || '', subject: tr.subject || '',
      customer_name: ef.customer_name || null, event_date: ef.event_date || null,
      guest_count: ef.guest_count || null, status: tr.status || 'new',
      email_date: tr.date || null, updated_at: tr.updated_at || '',
    });
  }

  // Step 3: Write new index
  await kvPipeline([['SET', 'inquiries:index', JSON.stringify(newIndex)]]);

  return res.status(200).json({
    ok: true,
    deleted: NON_WIX.length,
    kept: KEEP.length,
    index_count: newIndex.length,
    index: newIndex.map(e => ({ threadId: e.threadId, customer_name: e.customer_name, status: e.status, email_date: e.email_date })),
  });
};
