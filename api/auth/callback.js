/**
 * GET /api/auth/callback
 * OAuth 2.0 callback from Google.
 * - Exchanges code for tokens
 * - Validates the authed account is REQUIRED_EMAIL (info@blusbarbeque.com)
 *   using Gmail users.getProfile (works with gmail.send scope only)
 * - Rejects and redirects with error if wrong account
 * - Stores tokens at gmail:{email} key (account-specific)
 * - Deletes any legacy gmail:tokens key
 */
const https = require('https');

const REQUIRED_EMAIL = 'info@blusbarbeque.com';
const KV_TOKENS_KEY = `gmail:${REQUIRED_EMAIL}`;
const KV_TOKENS_KEY_LEGACY = 'gmail:tokens';

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvPipeline(commands) {
  const url = kvUrl(), token = kvToken();
  if (!url) return;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(commands);
    const u = new URL(`${url}/pipeline`);
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

async function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method: 'GET', headers };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.end();
  });
}

module.exports = async (req, res) => {
  const { code, error } = req.query || {};
  if (error) return res.redirect(`/?gmailError=${encodeURIComponent(error)}`);
  if (!code) return res.status(400).send('Missing authorization code');

  const redirectUri = `${process.env.APP_URL || 'https://blus-bbq.vercel.app'}/api/auth/callback`;
  const tokenBody = new URLSearchParams({
    code,
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();

  const tokenResp = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenBody)
      }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: 'parse_failed' }); } });
    });
    req.on('error', reject);
    req.write(tokenBody);
    req.end();
  });

  if (tokenResp.error) {
    return res.redirect(`/?gmailError=${encodeURIComponent(tokenResp.error_description || tokenResp.error)}`);
  }

  // ── ACCOUNT VALIDATION via Gmail API (works with gmail.send scope only) ───────────────────────
  // Use Gmail users.getProfile to confirm which account granted access
  const profile = await httpsGet('gmail.googleapis.com', '/gmail/v1/users/me/profile', {
    Authorization: `Bearer ${tokenResp.access_token}`
  });

  const authedEmail = (profile.emailAddress || '').toLowerCase().trim();
  if (authedEmail !== REQUIRED_EMAIL) {
    const errMsg = authedEmail
      ? `Wrong account: signed in as ${authedEmail}. Only ${REQUIRED_EMAIL} is allowed. Please sign in with the correct account.`
      : `Could not verify Gmail account. Please try again.`;
    return res.redirect(`/?gmailError=${encodeURIComponent(errMsg)}`);
  }
  // ───────────────────────────────────────────────────────────────────────────

  // Store at account-specific key AND delete the legacy key atomically
  await kvPipeline([
    ['SET', KV_TOKENS_KEY, JSON.stringify({
      email: REQUIRED_EMAIL,
      access_token: tokenResp.access_token,
      refresh_token: tokenResp.refresh_token || null,
      expiry_date: Date.now() + (tokenResp.expires_in || 3600) * 1000,
      scope: tokenResp.scope,
      token_type: tokenResp.token_type,
      storedAt: new Date().toISOString(),
    })],
    ['DEL', KV_TOKENS_KEY_LEGACY], // remove any legacy blusoperations tokens
  ]);

  return res.redirect(`/?gmailConnected=1&hasRefreshToken=${tokenResp.refresh_token ? '1' : '0'}&account=${encodeURIComponent(REQUIRED_EMAIL)}`);
};
