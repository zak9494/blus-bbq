/* ===== DESSERT TRIGGER
   Given an inquiry where the customer just replied AND status === 'quote_sent',
   either:
     - (default) emit a notification prompting Zach to consider a dessert add-on
     - (when dessert_to_approval_queue_v1 ON) draft a dessert-offer email and
       enqueue it on the AI approval queue so Zach can review/edit before send.
   Gated behind ai_dessert_trigger feature flag (default off). The
   approval-queue routing is gated behind dessert_to_approval_queue_v1
   (default off); when OFF, the legacy notification path runs unchanged.

   Exports: maybeTriggerDessertOffer, buildDessertOfferDraft
   ===== */
'use strict';
const https = require('https');
const crypto = require('crypto');
const { getFlag } = require('./flags.js');
const { createNotification } = require('./notifications.js');

const APPROVAL_QUEUE_KEY = 'chat:approval:queue';
const APPROVAL_QUEUE_MAX = 20;

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

function kvGetRaw(key) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const u = new URL(url.replace(/\/+$/, '') + '/get/' + encodeURIComponent(key));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { Authorization: 'Bearer ' + tok } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function kvSetRaw(key, value) {
  return new Promise((resolve, reject) => {
    const url = kvUrl(), tok = kvToken();
    if (!url) return reject(new Error('KV env vars not set'));
    const body = JSON.stringify([['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]]);
    const u = new URL(url.replace(/\/+$/, '') + '/pipeline');
    const req = https.request({ hostname: u.hostname, path: u.pathname,
      method: 'POST', headers: { Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      r.resume().on('end', resolve);
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function extractCustomerEmail(inquiry) {
  const ef = inquiry.extracted_fields || {};
  if (ef.customer_email) return String(ef.customer_email).trim();
  if (inquiry.customer_email) return String(inquiry.customer_email).trim();
  // Parse "Name <addr@example.com>" or bare "addr@example.com" from `from` header
  const from = inquiry.from || '';
  const angle = from.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim();
  const bare = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return bare ? bare[0].trim() : '';
}

function buildDessertOfferDraft(inquiry) {
  const ef = inquiry.extracted_fields || {};
  const fullName = ef.customer_name || '';
  const firstName = (fullName.split(' ')[0] || '').trim() || 'there';
  const eventDate = ef.event_date || '';
  const guestCount = ef.guest_count || 0;

  const subject = "Quick add-on idea for your Blu's BBQ catering";

  const eventLine = eventDate
    ? `for your event on ${eventDate}`
    : 'for your upcoming event';
  const guestLine = guestCount
    ? ` Since you're feeding around ${guestCount} guests, our peach cobbler or banana pudding scales nicely and runs about $3 per person.`
    : ' Our peach cobbler and banana pudding both scale nicely with the rest of the spread and run about $3 per person.';

  const body = [
    `Hi ${firstName},`,
    '',
    `Thanks for getting back to me ${eventLine}. Before we lock things in, I wanted to mention we can add a dessert to round out the meal.${guestLine}`,
    '',
    'Want me to add one? Happy to send an updated quote either way.',
    '',
    'Thanks,',
    'Zach',
    "Blu's Barbeque",
    '214-514-8684',
  ].join('\n');

  return { subject, body };
}

async function enqueueApprovalItem(item) {
  const raw = await kvGetRaw(APPROVAL_QUEUE_KEY);
  let items = [];
  if (raw) {
    try { items = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { items = []; }
  }
  if (!Array.isArray(items)) items = [];
  items.unshift(item);
  if (items.length > APPROVAL_QUEUE_MAX) items.length = APPROVAL_QUEUE_MAX;
  await kvSetRaw(APPROVAL_QUEUE_KEY, JSON.stringify(items));
  return item;
}

async function routeDessertOfferToApprovalQueue(inquiry) {
  const to = extractCustomerEmail(inquiry);
  if (!to) return null; // can't queue an email with no recipient
  const { subject, body } = buildDessertOfferDraft(inquiry);
  const item = {
    id: 'ap-dessert-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    to,
    name: (inquiry.extracted_fields && inquiry.extracted_fields.customer_name) || to,
    subject,
    body,
    inquiryId: inquiry.threadId || inquiry.inquiryId || '',
    draftType: 'email',
    source: 'dessert_trigger',
    createdAt: new Date().toISOString(),
  };
  await enqueueApprovalItem(item);
  return { queued: true, id: item.id };
}

async function maybeTriggerDessertOffer(inquiry) {
  if (!inquiry) return null;
  const enabled = await getFlag('ai_dessert_trigger', false);
  if (!enabled) return null;
  if (inquiry.status !== 'quote_sent') return null;

  const routeToQueue = await getFlag('dessert_to_approval_queue_v1', false);
  if (routeToQueue) {
    try {
      return await routeDessertOfferToApprovalQueue(inquiry);
    } catch {
      // Fall back to notification if KV write fails so Zach still gets a signal.
    }
  }

  const ef = inquiry.extracted_fields || {};
  const customerName = ef.customer_name || 'the customer';
  const eventDate    = ef.event_date    || '';

  const title = 'Offer dessert? — ' + customerName;
  const body  = customerName + ' replied to their catering quote' +
    (eventDate ? ' (event: ' + eventDate + ')' : '') +
    '. Consider offering a dessert add-on before they finalize.';

  return createNotification({
    type:      'customer_reply',
    title,
    body,
    inquiryId: inquiry.threadId || inquiry.inquiryId || null,
    metadata:  { suggestion: 'dessert_add_on' },
    severity:  'low',
    icon:      'bell',
    sound:     'default',
  });
}

module.exports = { maybeTriggerDessertOffer, buildDessertOfferDraft };
