/**
 * GET /api/auth/init
 * Builds Google OAuth URL with offline access and redirects the user.
 * Tokens land in /api/auth/callback → stored in Upstash KV.
 */
module.exports = (req, res) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) return res.status(500).send('GMAIL_CLIENT_ID env var not set');
  const appUrl = process.env.APP_URL || 'https://blus-bbq.vercel.app';
  const redirectUri = `${appUrl}/api/auth/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return res.redirect(302, url.toString());
};
