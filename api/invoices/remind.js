/* ===== POST /api/invoices/remind
   Body: { secret, id }
   Sends a payment reminder email via Gmail using stored OAuth tokens.
   ===== */
'use strict';
const { kvGet, parseBody, requireFlag, secretOk } = require('./_lib.js');
const { google } = require('googleapis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireFlag(res)) return;

  const body = await parseBody(req);
  if (!secretOk(body)) return res.status(401).json({ error: 'Unauthorized' });

  const id = body.id || (req.query && req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const raw = await kvGet('invoice:' + id);
  if (!raw) return res.status(404).json({ error: 'Invoice not found' });

  const inv = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (inv.status === 'void') return res.status(400).json({ error: 'Cannot send reminder for voided invoice' });
  if ((inv.balance || 0) <= 0.005) return res.status(400).json({ error: 'Invoice is already paid' });
  if (!inv.customerEmail) return res.status(400).json({ error: 'No customer email on file' });

  const tokRaw = await kvGet('gmail:info@blusbarbeque.com');
  if (!tokRaw) return res.status(503).json({ error: 'Gmail not connected' });
  const tokens = typeof tokRaw === 'string' ? JSON.parse(tokRaw) : tokRaw;

  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );
  oauth2.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const profile = await gmail.users.getProfile({ userId: 'me' });
  if (profile.data.emailAddress !== 'info@blusbarbeque.com') {
    return res.status(403).json({ error: 'Sender mismatch — aborting' });
  }

  const eventDateStr = inv.eventDate
    ? new Date(inv.eventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const subject = `Payment Reminder — ${inv.invoiceNumber} — $${inv.balance.toFixed(2)} outstanding`;
  const bodyText = [
    `Hi ${inv.customerName || 'there'},`,
    '',
    `This is a friendly reminder that invoice ${inv.invoiceNumber} has an outstanding balance of $${inv.balance.toFixed(2)}.`,
    '',
    inv.dueDate ? `Due date: ${new Date(inv.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : '',
    eventDateStr ? `Event date: ${eventDateStr}` : '',
    '',
    `Invoice total: $${(inv.total || 0).toFixed(2)}`,
    `Amount paid:   $${(inv.amountPaid || 0).toFixed(2)}`,
    `Balance due:   $${inv.balance.toFixed(2)}`,
    '',
    'Please reach out if you have any questions.',
    '',
    'Thank you,',
    "Blu's Barbeque Catering",
    'info@blusbarbeque.com',
  ].filter(l => l !== null && l !== undefined).join('\n');

  const to = inv.customerEmail;
  const mimeLines = [
    `To: ${to}`,
    'From: Blu\'s Barbeque <info@blusbarbeque.com>',
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
  ].join('\r\n');

  const encoded = Buffer.from(mimeLines).toString('base64url');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });

  return res.status(200).json({ ok: true, sentTo: to });
};
