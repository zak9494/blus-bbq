/* ===== AI DRAFT GENERATOR
   Shared Claude helper for regenerate and add-details endpoints.
   Supports draftType: 'email' | 'quote_reply' | 'text'

   Exports: generateDraft, buildEmailSystemPrompt, buildQuoteReplySystemPrompt, buildTextSystemPrompt
   ===== */
'use strict';
const https = require('https');
const { businessConfig } = require('./business-config.js');

const MODEL = 'claude-sonnet-4-6';

function callClaude(systemPrompt, userMsg, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY not set'));
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens || 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function fmtCurrency(n) { return '$' + (Number(n) || 0).toFixed(2); }

function buildEmailSystemPrompt() {
  return `You are ${businessConfig.ownerName}, owner of ${businessConfig.name} in ${businessConfig.city}, ${businessConfig.state} (phone: ${businessConfig.phone}).
Write a warm, professional catering email to a potential customer.
Tone: friendly, personal, confident. Keep it under 200 words.

Rules:
- Open with "Hi [FirstName]," (use first name only)
- Thank them for reaching out
- Do not re-include answers the customer has already received in the thread. Focus only on new or unaddressed items.
- If a quote is provided, present the line items clearly and show the total prominently
- Invite them to stop by Wed\u2013Sun after 1 PM to try samples \u2014 "just ask for ${businessConfig.staffName}!"
- Close with your name, ${businessConfig.name}, and ${businessConfig.phone}
- Plain text only \u2014 no markdown, no bullet symbols, just line breaks`;
}

function buildQuoteReplySystemPrompt() {
  return `You are ${businessConfig.ownerName}, owner of ${businessConfig.name} in ${businessConfig.city}, ${businessConfig.state} (phone: ${businessConfig.phone}).
Write a brief, warm reply to a customer's question about their catering quote.
Tone: helpful, direct, friendly. Keep it under 100 words.

Rules:
- Open with "Hi [FirstName],"
- Answer the question directly and concisely
- Do not re-include information the customer has already received in the thread
- Close with your name and ${businessConfig.name}
- Plain text only`;
}

function buildTextSystemPrompt() {
  return `You are ${businessConfig.ownerName}, owner of ${businessConfig.name} in ${businessConfig.city}, ${businessConfig.state} (phone: ${businessConfig.phone}).
Write a short, warm SMS-style follow-up for a catering inquiry. Keep it under 60 words.
Conversational and friendly. No formal greetings. No subject line. Just the message text.`;
}

function buildEmailUserMsg(inquiry, addedContext, existingDraft) {
  const ef = (inquiry && inquiry.extracted_fields) || {};
  const q  = (inquiry && inquiry.quote) || null;
  const firstName = ((ef.customer_name || '').split(' ')[0]) || 'there';

  let lineItemsText = '';
  if (q && q.line_items && q.line_items.length > 0) {
    lineItemsText = '\nQuote line items:\n' + q.line_items.map(li =>
      li.name + ' (' + li.qty + ' ' + li.unit + ') \u2014 ' + fmtCurrency(li.subtotal)
    ).join('\n');
    lineItemsText += '\n\nFood subtotal: ' + fmtCurrency(q.food_subtotal);
    lineItemsText += '\nService charge: ' + fmtCurrency(q.service_charge);
    lineItemsText += '\nDelivery fee: '   + fmtCurrency(q.delivery_fee || 0);
    lineItemsText += '\nTOTAL: '          + fmtCurrency(q.total);
    if (q.notes) lineItemsText += '\nNotes: ' + q.notes;
  }

  const eventInfo = [
    ef.event_date  ? 'Event date: ' + ef.event_date  : null,
    ef.guest_count ? 'Guests: '     + ef.guest_count : null,
    ef.event_type  ? 'Event type: ' + ef.event_type  : null,
    ef.venue_name  ? 'Venue: '      + ef.venue_name  : null,
  ].filter(Boolean).join(', ');

  let msg = 'Customer first name: ' + firstName;
  if (eventInfo) msg += '\nEvent details: ' + eventInfo;
  if (lineItemsText) msg += lineItemsText;
  if (existingDraft) msg += '\n\nPrevious draft to revise:\n' + existingDraft;
  if (addedContext)  msg += '\n\nAdditional context / instructions:\n' + addedContext;
  msg += '\n\nPlease write the email now.';
  return msg;
}

function buildQuoteReplyUserMsg(inquiry, addedContext, existingDraft) {
  const ef = (inquiry && inquiry.extracted_fields) || {};
  const q  = (inquiry && inquiry.quote) || null;
  const firstName = ((ef.customer_name || '').split(' ')[0]) || 'there';
  let msg = 'Customer first name: ' + firstName;
  if (q && q.total) msg += '\nCurrent quote total: ' + fmtCurrency(q.total);
  if (existingDraft) msg += '\n\nPrevious draft:\n' + existingDraft;
  if (addedContext)  msg += '\n\nContext or customer question:\n' + addedContext;
  msg += '\n\nPlease write the reply now.';
  return msg;
}

function buildTextUserMsg(inquiry, addedContext) {
  const ef = (inquiry && inquiry.extracted_fields) || {};
  const firstName = ((ef.customer_name || '').split(' ')[0]) || 'there';
  let msg = 'Customer: ' + firstName;
  if (ef.event_date) msg += ', event date: ' + ef.event_date;
  if (addedContext)  msg += '\nContext: ' + addedContext;
  msg += '\n\nWrite the text message now.';
  return msg;
}

const DRAFT_CONFIGS = {
  email:       { system: buildEmailSystemPrompt,       user: buildEmailUserMsg,       maxTokens: 800 },
  quote_reply: { system: buildQuoteReplySystemPrompt,  user: buildQuoteReplyUserMsg,  maxTokens: 400 },
  text:        { system: buildTextSystemPrompt,         user: buildTextUserMsg,        maxTokens: 200 },
};

async function generateDraft({ inquiry, draftType, addedContext, existingDraft }) {
  const cfg = DRAFT_CONFIGS[draftType];
  if (!cfg) throw new Error('Unknown draftType: ' + draftType + '. Must be email|quote_reply|text');

  const systemPrompt = cfg.system();
  const userMsg = draftType === 'text'
    ? cfg.user(inquiry, addedContext)
    : cfg.user(inquiry, addedContext, existingDraft);

  const result = await callClaude(systemPrompt, userMsg, cfg.maxTokens);
  if (result.error || !result.content) {
    throw new Error('Claude API error: ' + JSON.stringify(result.error || result).slice(0, 300));
  }

  const ef = (inquiry && inquiry.extracted_fields) || {};
  const name = ef.customer_name || '';
  const subject = draftType === 'email'
    ? 'Re: ' + businessConfig.shortName + ' \u2014 Catering for ' + (name || 'Your Event')
    : null;

  return {
    subject,
    body: result.content[0].text.trim(),
    draftType,
    model: result.model,
    input_tokens:  result.usage && result.usage.input_tokens,
    output_tokens: result.usage && result.usage.output_tokens,
  };
}

module.exports = {
  generateDraft,
  buildEmailSystemPrompt,
  buildQuoteReplySystemPrompt,
  buildTextSystemPrompt,
};
