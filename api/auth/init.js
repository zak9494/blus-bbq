/**
 * GET /api/auth/init
 * Builds Google OAuth URL with offline access and redirects the user.
 * Forces account picker and hints to the canonical sender address.
 * Requests gmail.send + email scopes so id_token contains email for validation.
 * Tokens land in /api/auth/callback → stored in Upstash KV.
 */

const REQUIRED_EMAIL = 'info@blusbarbeque.com';

module.exports = (req, res) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) return res.status(500).send('GMAIL_CLIENT_ID env var not set');

  const appUrl = process.env.APP_URL || 'https://blus-bbq.vercel.app';
  const redirectUri = `${appUrl}/api/auth/callback`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  // gmail.send for sending emails; calendar (full) covers calendarList.list,
  // calendars.insert, events.*, and events.watch — calendar.events alone is
  // insufficient for getOrCreateCalendarId() which calls the calendarList API.
  // openid + email so id_token carries the user email for account validation.
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
    'openid',
    'email',
  ].join(' '));
  url.searchParams.set('access_type', 'offline');
  // Force the account picker and pre-select the required sender
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('login_hint', REQUIRED_EMAIL);

  return res.redirect(302, url.toString());
};
