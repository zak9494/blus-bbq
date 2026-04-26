/**
 * POST /api/sms/status
 * Twilio delivery-status webhook stub.
 *
 * Twilio POSTs here when a message delivery status changes (delivered, failed, etc.).
 * Configure in Twilio console: Messaging → Active Numbers → Status Callback URL.
 *
 * Body (application/x-www-form-urlencoded from Twilio):
 *   MessageSid, MessageStatus, To, From, ErrorCode (optional)
 *
 * Currently logs the event and returns 204. Wire up KV persistence here when
 * the sms_channel feature ships beyond stub mode.
 */

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { MessageSid, MessageStatus, To, From, ErrorCode } = req.body || {};
  console.log('[sms/status]', { MessageSid, MessageStatus, To, From, ErrorCode: ErrorCode || null });

  // Return 204 — Twilio expects a 2xx or it will retry.
  return res.status(204).end();
};
