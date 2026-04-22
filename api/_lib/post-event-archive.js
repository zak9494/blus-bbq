/* ===== POST-EVENT ARCHIVE
   Daily logic: finds inquiries where event_date === yesterday AND
   status is not booked/completed/archived/lost. Moves them to 'lost',
   generates a "hope to serve you" draft email, and creates a notification
   for Zach to review. Does NOT send any email.

   Exports: runPostEventArchive
   ===== */
'use strict';
const https = require('https');
const { createNotification } = require('./notifications.js');

const MODEL     = 'claude-sonnet-4-6';
const INDEX_KEY = 'inquiries:index';
const SKIP_STATUSES = new Set(['booked', 'completed', 'archived', 'lost']);

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvExec(commands) {
  const url = kvUrl(), tok = kvToken();
  if (!url) return Promise.reject(new Error('KV env vars not set'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(url + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function parse(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

// Returns yesterday's date string in CT (approximate CST = UTC-6)
function yesterdayCT() {
  const now  = new Date();
  const ct   = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const prev = new Date(ct.getTime() - 24 * 60 * 60 * 1000);
  return prev.toISOString().slice(0, 10);
}

async function generateHopeToServeDraft(inquiry) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const ef = inquiry.extracted_fields || {};
  const firstName = ((ef.customer_name || '').split(' ')[0]) || 'there';
  const eventType = ef.event_type || 'your event';

  const systemPrompt = `You are Zach, owner of Blu's Barbeque in Dallas, TX (phone: 214-514-8684).
Write a warm, brief follow-up email to someone whose catering event has now passed but who never booked.
Tone: genuinely warm, no pressure, hopeful for future business. Under 100 words.
Rules:
- Open with "Hi [FirstName],"
- Express hope that their event went well
- Mention you'd love to serve them next time
- Invite them to stop by any time for a taste
- Close with your name, Blu's Barbeque, 214-514-8684
- Plain text only`;

  const userMsg = `Customer first name: ${firstName}\nEvent type: ${eventType}${ef.event_date ? '\nEvent date was: ' + ef.event_date : ''}\n\nWrite the email now.`;

  const body = JSON.stringify({
    model: MODEL, max_tokens: 250,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve(parsed.content && parsed.content[0] ? parsed.content[0].text.trim() : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

async function runPostEventArchive({ dryRun = false } = {}) {
  const yesterday = yesterdayCT();
  const now = new Date().toISOString();
  const errors = [];
  let scanned = 0, archived = 0;

  const rawIndex = await kvGet(INDEX_KEY);
  const index = parse(rawIndex) || [];

  for (const entry of index) {
    const { threadId, status } = entry;
    if (!threadId || SKIP_STATUSES.has(status)) continue;

    let record;
    try {
      record = parse(await kvGet('inquiries:' + threadId));
      if (!record) continue;
    } catch (e) {
      errors.push({ threadId, error: 'load: ' + e.message });
      continue;
    }

    const ef = record.extracted_fields || {};
    if (!ef.event_date || ef.event_date !== yesterday) continue;

    scanned++;
    if (dryRun) { archived++; continue; }

    // Generate hope-to-serve draft (best-effort, non-fatal)
    let archiveDraft = null;
    try { archiveDraft = await generateHopeToServeDraft(record); } catch { /* non-fatal */ }

    const actEntry = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: now,
      type: 'status_change',
      summary: 'Auto-archived: event date passed without booking',
      diff: [{ field: 'status', old: status, new: 'lost' }],
      acknowledged: false,
    };

    const updatedRecord = {
      ...record,
      status: 'lost',
      lost_reason: 'auto_archive_post_event',
      updatedAt: now,
      archive_draft: archiveDraft,
      activity_log: [...(record.activity_log || []), actEntry],
    };

    const updatedEntry = { ...entry, status: 'lost', updatedAt: now };
    const updatedIndex = index.map(e => e.threadId === threadId ? updatedEntry : e);

    try {
      await kvExec([
        ['SET', 'inquiries:' + threadId, JSON.stringify(updatedRecord)],
        ['SET', INDEX_KEY, JSON.stringify(updatedIndex)],
      ]);
    } catch (e) {
      errors.push({ threadId, error: 'save: ' + e.message });
      continue;
    }

    // Create notification for Zach to review
    try {
      const customerName = ef.customer_name || 'Unknown customer';
      await createNotification({
        type:      'post_event_archive',
        title:     'Review hope-to-serve draft — ' + customerName,
        body:      customerName + "'s event (" + yesterday + ') passed without booking. Draft ready to review.',
        inquiryId: threadId,
        metadata:  { event_date: yesterday, had_draft: !!archiveDraft },
        severity:  'low',
        icon:      'bell',
        sound:     'default',
      });
    } catch { /* non-fatal */ }

    archived++;
  }

  return { ok: true, yesterday, scanned, archived, errors };
}

module.exports = { runPostEventArchive, yesterdayCT };
