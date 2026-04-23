/**
 * POST/GET /api/cron/weekly-digest
 * Monday 8 AM CT weekly digest email to Zach.
 *
 * Auth:
 *   - Vercel cron: Authorization: Bearer {CRON_SECRET}
 *   - Manual test: ?secret=GMAIL_READ_SECRET
 *
 * Content:
 *   - This week's events (grouped by day)
 *   - Outstanding quotes (>5 days unanswered)
 *   - Overdue follow-ups
 *   - One-line thank-you
 *
 * Feature-flagged: weekly_digest (default off).
 * Respects test-mode email: if test mode email is set, sends there instead.
 * Recipient: settings:digest_recipient (skip + log if unset).
 */
module.exports.config = { maxDuration: 60 };

'use strict';
const https  = require('https');
const { getFlag }            = require('../_lib/flags.js');
const { getTestModeEmail }   = require('../_lib/settings.js');

const CANONICAL_SENDER = 'info@blusbarbeque.com';
const KV_TOKENS_KEY    = 'gmail:' + CANONICAL_SENDER;

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGet(key) {
  return new Promise(resolve => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return resolve(null);
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

// ── Gmail token refresh ────────────────────────────────────────────────────────
async function getAccessToken() {
  const raw = await kvGet(KV_TOKENS_KEY);
  if (!raw) throw new Error('Gmail not authenticated — visit /api/auth/init');
  const tokens = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let { access_token, refresh_token, expiry_date } = tokens;

  if (!access_token || (expiry_date && expiry_date < Date.now() + 60000)) {
    if (!refresh_token) throw new Error('No refresh token — re-auth at /api/auth/init');
    const body = new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token, grant_type: 'refresh_token',
    }).toString();
    const rr = await new Promise((resolve, reject) => {
      const data = Buffer.from(body);
      const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length } }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      });
      req.on('error', reject); req.write(data); req.end();
    });
    if (!rr.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(rr));
    access_token = rr.access_token;
  }
  return access_token;
}

// ── Send email via Gmail API ───────────────────────────────────────────────────
async function sendGmail(accessToken, to, subject, htmlBody) {
  // Verify sender matches canonical
  const profileRes = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/profile', method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject); req.end();
  });
  const senderEmail = (profileRes.emailAddress || '').toLowerCase();
  if (senderEmail !== CANONICAL_SENDER) {
    throw new Error('Sender mismatch: ' + senderEmail + ' !== ' + CANONICAL_SENDER);
  }

  const raw = [
    'From: Blu\'s Barbeque <' + CANONICAL_SENDER + '>',
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ raw: encoded });
    const req = https.request({ hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/messages/send', method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(s) {
  if (!s) return '—';
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
}

function fmtMoney(n) {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Build digest HTML ──────────────────────────────────────────────────────────
function buildDigestHtml(weekLabel, thisWeekEvents, outstandingQuotes, overdueFollowups) {
  const styles = `
    body { font-family: 'DM Sans', Arial, sans-serif; background: #f8f6f2; color: #1a1a1a; margin: 0; padding: 0; }
    .wrap { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; margin-top: 24px; }
    .header { background: #1a1a1a; padding: 24px 32px; }
    .header h1 { color: #ff8800; font-size: 28px; margin: 0; letter-spacing: 0.04em; }
    .header p { color: #888; font-size: 13px; margin: 4px 0 0; }
    .section { padding: 24px 32px; border-bottom: 1px solid #eee; }
    .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 0 0 14px; }
    .row { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .row:last-child { border-bottom: none; }
    .row-name { font-weight: 600; font-size: 14px; margin-bottom: 3px; }
    .row-meta { font-size: 12px; color: #666; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge-red { background: #fee2e2; color: #dc2626; }
    .badge-amber { background: #fef3c7; color: #d97706; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .empty { color: #aaa; font-size: 13px; padding: 8px 0; }
    .footer { padding: 20px 32px; background: #fafafa; font-size: 12px; color: #aaa; text-align: center; }
  `;

  let eventsHtml = '';
  if (thisWeekEvents.length === 0) {
    eventsHtml = '<div class="empty">No events scheduled this week.</div>';
  } else {
    // Group by date
    const byDate = {};
    for (const e of thisWeekEvents) {
      const key = e.eventDate || 'Unknown Date';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(e);
    }
    for (const [date, evts] of Object.entries(byDate)) {
      eventsHtml += `<div style="font-size:12px;font-weight:700;color:#888;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.06em">${fmtDate(date)}</div>`;
      for (const e of evts) {
        eventsHtml += `
          <div class="row">
            <div class="row-name">${e.name}</div>
            <div class="row-meta">${e.guestCount ? e.guestCount + ' guests' : ''}${e.eventType ? ' &bull; ' + e.eventType : ''}${e.quoteTotal ? ' &bull; ' + fmtMoney(e.quoteTotal) : ''}</div>
          </div>`;
      }
    }
  }

  let quotesHtml = '';
  if (outstandingQuotes.length === 0) {
    quotesHtml = '<div class="empty">No outstanding quotes over 5 days.</div>';
  } else {
    for (const q of outstandingQuotes) {
      quotesHtml += `
        <div class="row">
          <div class="row-name">${q.name} <span class="badge badge-amber">${q.daysSinceSent}d ago</span></div>
          <div class="row-meta">${q.eventDate ? 'Event: ' + fmtDate(q.eventDate) : ''}${q.quoteTotal ? ' &bull; Quote: ' + fmtMoney(q.quoteTotal) : ''}</div>
        </div>`;
    }
  }

  let followupsHtml = '';
  if (overdueFollowups.length === 0) {
    followupsHtml = '<div class="empty">No overdue follow-ups.</div>';
  } else {
    for (const f of overdueFollowups) {
      followupsHtml += `
        <div class="row">
          <div class="row-name">${f.name} <span class="badge badge-red">Overdue</span></div>
          <div class="row-meta">${f.eventDate ? 'Event: ' + fmtDate(f.eventDate) : ''}${f.status ? ' &bull; ' + f.status : ''}</div>
        </div>`;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>${styles}</style></head><body>
  <div class="wrap">
    <div class="header">
      <h1>Blu's BBQ</h1>
      <p>Weekly Operations Digest &mdash; ${weekLabel}</p>
    </div>
    <div class="section">
      <h2>📅 This Week's Events</h2>
      ${eventsHtml}
    </div>
    <div class="section">
      <h2>⏳ Outstanding Quotes (&gt;5 days)</h2>
      ${quotesHtml}
    </div>
    <div class="section">
      <h2>🔔 Overdue Follow-Ups</h2>
      ${followupsHtml}
    </div>
    <div class="footer">
      Thank you for another great week of BBQ! 🔥<br>
      Sent automatically from Blu's BBQ Operations Dashboard.
    </div>
  </div>
  </body></html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const cronSecret  = process.env.CRON_SECRET;
  const gmailSecret = process.env.GMAIL_READ_SECRET;
  const authHeader  = req.headers.authorization;
  const provided    = (req.query && req.query.secret) || req.headers['x-secret'];

  const cronOk   = cronSecret  && authHeader === 'Bearer ' + cronSecret;
  const manualOk = gmailSecret && provided   === gmailSecret;
  if (!cronOk && !manualOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Feature flag check
  const enabled = await getFlag('weekly_digest', false);
  if (!enabled) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'weekly_digest flag is off' });
  }

  // Determine recipient
  const recipientRaw = await kvGet('settings:digest_recipient');
  const baseRecipient = typeof recipientRaw === 'string' ? recipientRaw.trim() : '';

  const testEmail = await getTestModeEmail();
  const recipient = testEmail || baseRecipient;

  if (!recipient) {
    console.log('[weekly-digest] No recipient configured — skipping send. Set settings:digest_recipient.');
    return res.status(200).json({ ok: true, skipped: true, reason: 'no digest_recipient configured' });
  }

  try {
    const now        = Date.now();
    const weekStart  = now - 7 * MS_PER_DAY;
    const weekEnd    = now + 7 * MS_PER_DAY;

    // Load inquiries index
    const rawIdx = await kvGet('inquiries:index');
    const index  = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];
    const active = Array.isArray(index) ? index.filter(i => i.status !== 'archived') : [];

    // ── This week's events ─────────────────────────────────────────────────────
    const thisWeekEvents = active
      .filter(i => {
        const d = parseDate(i.event_date || i.eventDate);
        return d && d.getTime() >= weekStart && d.getTime() <= weekEnd;
      })
      .map(i => ({
        name:       i.name || i.customer_name || 'Unknown',
        eventDate:  i.event_date || i.eventDate || '',
        guestCount: i.guest_count || i.guestCount || null,
        eventType:  i.event_type || '',
        quoteTotal: i.quote_total || i.quoteTotal || null,
        status:     i.status,
      }))
      .sort((a, b) => new Date(a.eventDate || 0) - new Date(b.eventDate || 0));

    // ── Outstanding quotes >5 days ─────────────────────────────────────────────
    const outstandingQuotes = active
      .filter(i => {
        if (i.status !== 'quote_sent') return false;
        const sent = parseDate(i.quote_sent_at || i.updated_at || i.storedAt);
        return sent && (now - sent.getTime()) > 5 * MS_PER_DAY && !i.has_customer_reply;
      })
      .map(i => {
        const sent = parseDate(i.quote_sent_at || i.updated_at || i.storedAt);
        return {
          name:         i.name || i.customer_name || 'Unknown',
          eventDate:    i.event_date || i.eventDate || '',
          quoteTotal:   i.quote_total || i.quoteTotal || null,
          daysSinceSent: sent ? Math.floor((now - sent.getTime()) / MS_PER_DAY) : 0,
        };
      })
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent);

    // ── Overdue follow-ups — inquiries approved but no recent activity ─────────
    const overdueFollowups = active
      .filter(i => {
        if (!i.approved || i.status === 'booked') return false;
        const updated = parseDate(i.updated_at || i.storedAt);
        return updated && (now - updated.getTime()) > 7 * MS_PER_DAY;
      })
      .map(i => ({
        name:      i.name || i.customer_name || 'Unknown',
        eventDate: i.event_date || i.eventDate || '',
        status:    i.status,
      }))
      .slice(0, 10);

    // ── Build week label ───────────────────────────────────────────────────────
    const weekStartDate = new Date(weekStart);
    const weekLabel = weekStartDate.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
    }) + ' week';

    const html    = buildDigestHtml(weekLabel, thisWeekEvents, outstandingQuotes, overdueFollowups);
    const subject = 'Blu\'s BBQ — Weekly Digest (' + weekLabel + ')';

    const accessToken = await getAccessToken();
    const sendResult  = await sendGmail(accessToken, recipient, subject, html);

    if (sendResult.status >= 300) {
      throw new Error('Gmail send failed: ' + JSON.stringify(sendResult.body).slice(0, 200));
    }

    return res.status(200).json({
      ok: true,
      sentTo:         recipient,
      isTestMode:     !!testEmail,
      eventsCount:    thisWeekEvents.length,
      quotesCount:    outstandingQuotes.length,
      followupsCount: overdueFollowups.length,
      messageId:      sendResult.body.id || null,
      sentAt:         new Date().toISOString(),
    });
  } catch (err) {
    console.error('[weekly-digest] Error:', err.message);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
