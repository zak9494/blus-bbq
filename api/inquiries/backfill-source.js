/**
 * GET /api/inquiries/backfill-source
 * One-shot: adds source + approved fields to existing KV inquiry records
 * and rebuilds the index. TEMPORARY — delete after use.
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

function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
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

function detectSource(from, subject) {
  const f = (from  || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  if (f.includes('@ezcater.com') || f.includes('ezcater') || s.includes('ezcater')) return 'ezcater';
  if ((s.includes('got a new submission') || s.includes('new catering inquiry') ||
       s.includes('new contact form submission')) && f.includes('blusbarbeque.com')) return 'wix';
  return 'direct';
}

module.exports = async (req, res) => {
  if (req.method \!== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (\!secret || provided \!== secret) return res.status(401).json({ error: 'Unauthorized' });

  // Load the existing index
  const idxRaw = await kvGet('inquiries:index');
  if (\!idxRaw) return res.status(200).json({ ok: false, error: 'No index found' });
  const index = typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw;

  const results = [];
  const newIndex = [];

  for (const entry of index) {
    const tid = entry.threadId;
    const recRaw = await kvGet('inquiries:' + tid);
    if (\!recRaw) {
      results.push({ threadId: tid, error: 'not found in KV' });
      continue;
    }
    const rec = typeof recRaw === 'string' ? JSON.parse(recRaw) : recRaw;

    // Detect source if not already set
    const source = rec.source || detectSource(rec.from, rec.subject);
    // Set approved to false if not already set (preserve existing approved:true)
    const approved = rec.approved \!== undefined ? rec.approved : false;

    // Update record
    rec.source = source;
    rec.approved = approved;
    await kvSet('inquiries:' + tid, rec);

    // Build index entry with source + approved
    const ef = rec.extracted_fields || {};
    newIndex.push({
      threadId:      tid,
      from:          rec.from || '',
      subject:       rec.subject || '',
      customer_name: ef.customer_name || null,
      event_date:    ef.event_date   || null,
      guest_count:   ef.guest_count  || null,
      status:        rec.status || 'new',
      email_date:    rec.date   || null,
      updated_at:    rec.updated_at || '',
      source:        source,
      approved:      approved,
    });

    results.push({ threadId: tid, source, approved, from: rec.from, subject: rec.subject });
  }

  // Sort by email_date descending
  newIndex.sort((a, b) => {
    const da = a.email_date ? new Date(a.email_date).getTime() : 0;
    const db = b.email_date ? new Date(b.email_date).getTime() : 0;
    return db - da;
  });

  await kvSet('inquiries:index', newIndex);

  const sourceCounts = results.reduce((acc, r) => {
    if (r.source) acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});

  return res.status(200).json({
    ok: true,
    processed: results.length,
    source_counts: sourceCounts,
    records: results,
  });
};
