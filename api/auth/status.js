/**
 * GET /api/auth/status
 * Returns Gmail connection status for the canonical sender.
 * { connected: boolean, email: string|null, hasRefreshToken: boolean }
 */
const https = require('https');
const { getAllowedAccounts, isAllowedAccount } = require('../_lib/allowed-accounts');

const KV_TOKENS_KEY_LEGACY = 'gmail:tokens';

function getKvTokensKey() { return `gmail:${getAllowedAccounts()[0]}`; }

function kvUrl() { return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL; }
function kvToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

async function kvGet(key) {
  const url = kvUrl(), token = kvToken();
  if (!url) return null;
  return new Promise(resolve => {
    const u = new URL(url + '/get/' + encodeURIComponent(key));
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { Authorization: 'Bearer ' + token } };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try canonical key, then legacy
  let tokensRaw = await kvGet(getKvTokensKey());
  const fromLegacy = !tokensRaw && !!(tokensRaw = await kvGet(KV_TOKENS_KEY_LEGACY));

  if (!tokensRaw) {
    return res.status(200).json({ connected: false, email: null, hasRefreshToken: false });
  }

  let tokens;
  try { tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw; }
  catch { return res.status(200).json({ connected: false, email: null, hasRefreshToken: false, error: 'token_parse_failed' }); }

  const storedEmail = (tokens.email || '').toLowerCase().trim();
  const hasRefreshToken = !!tokens.refresh_token;

  if (storedEmail && !isAllowedAccount(storedEmail)) {
    return res.status(200).json({ connected: false, email: storedEmail, hasRefreshToken, error: 'wrong_account', message: `Connected as ${storedEmail}, but this account is not in the allowed list. Re-authenticate.` });
  }

  if (fromLegacy || !storedEmail) {
    return res.status(200).json({ connected: false, email: null, hasRefreshToken, error: 'legacy_token', message: 'Gmail tokens need re-authentication. Visit /api/auth/init.' });
  }

  // Include scope so the client can verify calendar access without guessing.
  // calendar.events (sensitive) is sufficient for all event CRUD + watch.
  // calendar (restricted, requires app verification) is only needed for
  // calendarList.list / calendars.insert — which we no longer call.
  const scope = tokens.scope || null;
  const hasCalendar = !!(scope && (
    scope.includes('/auth/calendar.events') ||
    scope.includes('/auth/calendar ') ||
    scope.endsWith('/auth/calendar')
  ));
  return res.status(200).json({ connected: true, email: storedEmail, hasRefreshToken, scope, hasCalendar, storedAt: tokens.storedAt || null });
};
