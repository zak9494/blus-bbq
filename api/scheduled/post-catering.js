/**
 * GET /api/scheduled/post-catering
 *
 * Lists email tasks scheduled to send AFTER the event_date of their linked
 * inquiry — i.e. thank-you notes, review requests, anniversary follow-ups.
 *
 * Joins:
 *   - tasks:all         (scheduled email tasks; filtered to channel=email)
 *   - inquiries:index   (event_date + customer_name lookup by threadId)
 *
 * A task qualifies as "post-catering" when:
 *   - task.channel === 'email'
 *   - task.status  === 'scheduled' (not sent/failed/cancelled)
 *   - task.leadId matches an inquiry whose event_date is set AND
 *     new Date(task.sendAt) > new Date(inquiry.event_date)
 *
 * Returns: { ok, count, items: [{
 *   taskId, leadId, sendAt, status,
 *   customer_name, event_date,
 *   subject, to, emailType,   // emailType inferred from payload.template or subject
 *   qstashMessageId
 * }] }
 *
 * Cancel + reschedule are handled via the existing /api/tasks endpoint
 * (DELETE for cancel; reschedule = cancel + re-create via /api/schedule).
 */
'use strict';

const https = require('https');
const { getFlag } = require('../_lib/flags');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvPipeline(commands) {
  const url = kvUrl(), token = kvToken();
  if (!url) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(url + '/pipeline');
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) throw new Error('KV env vars not set');
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function inferEmailType(payload) {
  if (!payload) return 'follow-up';
  const tmpl = (payload.template || payload.type || '').toLowerCase();
  if (tmpl) return tmpl;
  const subj = (payload.subject || '').toLowerCase();
  if (subj.includes('thank'))                  return 'thank-you';
  if (subj.includes('review') || subj.includes('yelp') || subj.includes('google')) return 'review-request';
  if (subj.includes('anniversary') || subj.includes('last year')) return 'anniversary';
  return 'follow-up';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  // Flag gate — when OFF, return an empty list with a hint so the UI can hide
  // the section consistently with the client-side flag check.
  const enabled = await getFlag('post_catering_emails_v1');
  if (!enabled) {
    return res.status(200).json({
      ok: true, enabled: false, count: 0, items: [],
      hint: 'post_catering_emails_v1 flag is OFF',
    });
  }

  const limit = Math.min(parseInt((req.query && req.query.limit) || '100', 10) || 100, 200);

  try {
    // Fetch the most recent N task IDs (scheduled descending by sendAt).
    const range = await kvPipeline([
      ['ZRANGE', 'tasks:all', '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', '0', String(limit)],
    ]);
    const taskIds = (range[0] && range[0].result) || [];

    let tasks = [];
    if (taskIds.length) {
      const gets = taskIds.map(id => ['GET', 'task:' + id]);
      const results = await kvPipeline(gets);
      tasks = results
        .map(r => r && r.result).filter(Boolean)
        .map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
        .filter(Boolean);
    }

    // Inquiries index — for event_date + customer_name join.
    let inqRaw;
    try { inqRaw = await kvGet('inquiries:index'); } catch { inqRaw = null; }
    const inquiries = (() => {
      if (!inqRaw) return [];
      try { return typeof inqRaw === 'string' ? JSON.parse(inqRaw) : inqRaw; }
      catch { return []; }
    })();
    const inqByThread = new Map();
    for (const inq of (Array.isArray(inquiries) ? inquiries : [])) {
      if (inq && inq.threadId) inqByThread.set(inq.threadId, inq);
    }

    const items = [];
    for (const t of tasks) {
      if (t.channel && t.channel !== 'email')   continue;
      if (t.status && t.status !== 'scheduled') continue;
      if (!t.leadId || !t.sendAt)               continue;
      const inq = inqByThread.get(t.leadId);
      if (!inq || !inq.event_date)              continue;

      const sendAtMs   = new Date(t.sendAt).getTime();
      const eventAtMs  = new Date(inq.event_date).getTime();
      if (!isFinite(sendAtMs) || !isFinite(eventAtMs)) continue;
      if (sendAtMs <= eventAtMs)                       continue;

      const payload = t.payload || {};
      items.push({
        taskId:          t.taskId,
        leadId:          t.leadId,
        sendAt:          t.sendAt,
        status:          t.status,
        customer_name:   inq.customer_name || '',
        event_date:      inq.event_date,
        subject:         payload.subject || '(no subject)',
        to:              payload.to || '',
        emailType:       inferEmailType(payload),
        qstashMessageId: t.qstashMessageId || null,
      });
    }

    // Newest sendAt first (already roughly sorted but enforce after filter).
    items.sort((a, b) => new Date(b.sendAt) - new Date(a.sendAt));

    return res.status(200).json({ ok: true, enabled: true, count: items.length, items });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
