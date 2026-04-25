/**
 * GET /api/auth/init
 * Builds Google OAuth URL with offline access and redirects the user.
 * Forces account picker and hints to the canonical sender address.
 * Requests gmail.send + gmail.readonly + calendar + email scopes.
 * gmail.readonly is required by /api/gmail/list-inquiries (R4-1 Phase 1).
 * Tokens land in /api/auth/callback → stored in Upstash KV.
 */

const { getAllowedAccounts } = require('../_lib/allowed-accounts');

module.exports = (req, res) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) return res.status(500).send('GMAIL_CLIENT_ID env var not set');

  const appUrl = process.env.APP_URL || 'https://blus-bbq.vercel.app';
  const redirectUri = `${appUrl}/api/auth/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  // gmail.send for sending emails; gmail.readonly for reading/listing inbox emails
  // (required by /api/gmail/list-inquiries — added in R4-1 Phase 1).
  // calendar (full) covers calendarList.list, calendars.insert, events.*, and events.watch —
  // calendar.events alone is insufficient for getOrCreateCalendarId() which calls the calendarList API.
  // openid + email so id_token carries the user email for account validation.
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar',
    'openid',
    'email',
  ].join(' '));
  url.searchParams.set('access_type', 'offline');
  // Force the account picker and pre-select the required sender
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('login_hint', getAllowedAccounts()[0]);

  return res.redirect(302, url.toString());
};
