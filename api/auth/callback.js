/**
 * GET /api/auth/callback
 * OAuth 2.0 callback from Google. Exchanges code for tokens, stores in KV, redirects to dashboard.
 */
const https = require('https');

function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvSet(key, value) {
  const url = kvUrl(), token = kvToken();
  if (!url) return;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify([['SET', key, value]]);
    const u = new URL(`${url}/pipeline`);
    const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { r.resume().on('end', resolve); });
    req.on('error', resolve); req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  const { code, error } = req.query || {};
  if (error) return res.redirect(`/?gmailError=${encodeURIComponent(error)}`);
  if (!code) return res.status(400).send('Missing authorization code');

  const redirectUri = `${process.env.APP_URL || 'https://blus-bbq.vercel.app'}/api/auth/callback`;
  const tokenBody = new URLSearchParams({
    code, client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  }).toString();

  const tokenResp = await new Promise((resolve, reject) => {
    const opts = { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: 'parse_failed' }); } });
    });
    req.on('error', reject); req.write(tokenBody); req.end();
  });

  if (tokenResp.error) return res.redirect(`/?gmailError=${encodeURIComponent(tokenResp.error_description || tokenResp.error)}`);

  await kvSet('gmail:tokens', JSON.stringify({
    access_token: tokenResp.access_token,
    refresh_token: tokenResp.refresh_token || null,
    expiry_date: Date.now() + (tokenResp.expires_in || 3600) * 1000,
    scope: tokenResp.scope, token_type: tokenResp.token_type,
    storedAt: new Date().toISOString(),
  }));

  return res.redirect(`/?gmailConnected=1&hasRefreshToken=${tokenResp.refresh_token ? '1' : '0'}`);
};
