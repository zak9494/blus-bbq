/* ===== CADENCE TICK (QStash callback)
   POST /api/notifications/cadence-tick
   Called by QStash at the scheduled delay. Creates a follow_up_due notification
   for the inquiry and schedules the next follow-up if the event is still future.

   Auth: body.secret must equal SELF_MODIFY_SECRET (embedded by scheduleNextFollowUp).
   NOTE: Does NOT send email — Zach reviews notifications and sends manually.
   ===== */
'use strict';
const https = require('https');
const { getFlag }              = require('../_lib/flags.js');
const { createNotification }   = require('../_lib/notifications.js');
const { scheduleNextFollowUp } = require('../_lib/cadence-scheduler.js');

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — secret embedded by scheduleNextFollowUp at enqueue time
  const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
  const body     = req.body || {};
  if (!expected || body.secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Flag gate — return 200 so QStash does not keep retrying
  const enabled = await getFlag('notifications_center', false);
  if (!enabled) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'notifications_center flag disabled' });
  }

  const { inquiryId } = body;
  if (!inquiryId) return res.status(400).json({ error: 'inquiryId required' });

  // Fetch the inquiry record
  let inquiry = null;
  try {
    const raw = await kvGet('inquiries:' + inquiryId);
    inquiry = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch inquiry: ' + err.message });
  }

  if (!inquiry) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'inquiry not found' });
  }

  // Skip if inquiry status is not actionable
  const skipStatuses = ['archived', 'completed', 'cancelled'];
  if (skipStatuses.includes(inquiry.status)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'inquiry status: ' + inquiry.status });
  }

  // Create the follow_up_due notification
  let notif;
  try {
    const customerName = inquiry.customer_name || inquiry.name || 'customer';
    const eventDate    = inquiry.event_date || inquiry.email_date || 'unknown date';
    notif = await createNotification({
      type:      'follow_up_due',
      title:     'Follow-up due',
      body:      'Follow up with ' + customerName + ' — event on ' + eventDate,
      inquiryId,
      customerId: inquiry.customer_email || null,
      severity:  'medium',
      sound:     'chime',
      icon:      'clock',
      metadata:  { inquiryId, eventDate, customerName },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create notification: ' + err.message });
  }

  // Record follow-up timestamp on inquiry (best-effort; don't fail if it errors)
  inquiry.last_follow_up_at = new Date().toISOString();

  // Schedule the next follow-up
  let scheduleResult = { scheduled: false, reason: 'scheduling skipped' };
  try {
    scheduleResult = await scheduleNextFollowUp(inquiry);
  } catch (err) {
    console.error('[cadence-tick] scheduleNextFollowUp error:', err.message);
  }

  return res.status(200).json({
    ok:           true,
    notificationId: notif.id,
    scheduleResult,
  });
};
