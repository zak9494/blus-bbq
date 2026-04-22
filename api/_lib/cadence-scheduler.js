/* ===== CADENCE SCHEDULER
   Calculates the next follow-up timestamp for an inquiry based on days until
   the event, and enqueues a QStash job to fire api/notifications/cadence-tick.

   Cadence rules (days until event at time of calculation):
     ≤3 days  → follow up in 1 day
     4–7 days → follow up in 2 days
     8–21 days → follow up in 7 days
     22+ days → 4 days from now if no prior follow-up, else 7 days from now

   Exports: getNextFollowUpMs, scheduleNextFollowUp
   ===== */
'use strict';
const https = require('https');

const APP_URL    = process.env.APP_URL || 'https://blus-bbq.vercel.app';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function qstashHost() {
  const u = process.env.QSTASH_URL;
  if (u) { try { return new URL(u).hostname; } catch {} }
  return 'qstash.upstash.io';
}

async function qstashPublish(destUrl, body, delaySeconds) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN not set');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const host = qstashHost();
    const path = '/v2/publish/' + destUrl;
    const opts = {
      hostname: host,
      path,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Upstash-Delay':   Math.max(0, delaySeconds) + 's',
        'Upstash-Retries': '3',
      },
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

/**
 * Pure function — no side effects.
 * Returns the next follow_up_due timestamp in milliseconds, or null if the
 * event has already passed or event_date is missing/unparseable.
 *
 * @param {object} inquiry   Inquiry record with event_date and optionally last_follow_up_at
 * @param {number} [nowMs]   Reference timestamp (default: Date.now())
 * @returns {number|null}
 */
function getNextFollowUpMs(inquiry, nowMs) {
  if (nowMs === undefined) nowMs = Date.now();

  const eventDate = inquiry && (inquiry.event_date || inquiry.email_date);
  if (!eventDate) return null;

  const eventMs = new Date(eventDate).getTime();
  if (isNaN(eventMs) || eventMs <= nowMs) return null;

  // Full days remaining: floor so 3.5 days → 3 (stays in ≤3 bucket not 4–7)
  const daysUntil = Math.floor((eventMs - nowMs) / MS_PER_DAY);

  let intervalDays;
  if (daysUntil <= 3) {
    intervalDays = 1;
  } else if (daysUntil <= 7) {
    intervalDays = 2;
  } else if (daysUntil <= 21) {
    intervalDays = 7;
  } else {
    // 22+ days: first follow-up 4 days out; subsequent every 7 days
    intervalDays = inquiry.last_follow_up_at ? 7 : 4;
  }

  return nowMs + intervalDays * MS_PER_DAY;
}

/**
 * Enqueues a QStash job that will fire cadence-tick for the given inquiry.
 *
 * @param {object} inquiry  Full inquiry record (must have threadId or id, event_date)
 * @returns {Promise<{scheduled: boolean, reason?: string, delaySeconds?: number, nextAt?: string, qstashMessageId?: string}>}
 */
async function scheduleNextFollowUp(inquiry) {
  const nowMs  = Date.now();
  const nextMs = getNextFollowUpMs(inquiry, nowMs);

  if (!nextMs) {
    return { scheduled: false, reason: 'event is in the past or no event_date' };
  }

  const delaySeconds = Math.max(0, Math.round((nextMs - nowMs) / 1000));
  const destUrl      = APP_URL + '/api/notifications/cadence-tick';
  const payload      = {
    inquiryId: inquiry.threadId || inquiry.id,
    secret:    process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN,
  };

  const result = await qstashPublish(destUrl, payload, delaySeconds);

  return {
    scheduled:       true,
    delaySeconds,
    nextAt:          new Date(nextMs).toISOString(),
    qstashMessageId: result.body && result.body.messageId,
  };
}

module.exports = { getNextFollowUpMs, scheduleNextFollowUp };
