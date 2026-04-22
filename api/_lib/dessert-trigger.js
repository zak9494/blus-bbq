/* ===== DESSERT TRIGGER
   Given an inquiry where the customer just replied AND status === 'quote_sent',
   emit a notification prompting Zach to consider a dessert add-on offer.
   Does NOT send any email — notification surfaces the suggestion for human review.

   Exports: maybeTriggerDessertOffer
   ===== */
'use strict';
const { createNotification } = require('./notifications.js');

async function maybeTriggerDessertOffer(inquiry) {
  if (!inquiry) return null;
  if (inquiry.status !== 'quote_sent') return null;

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

module.exports = { maybeTriggerDessertOffer };
