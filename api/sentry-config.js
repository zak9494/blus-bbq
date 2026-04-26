'use strict';
// api/sentry-config.js
// Returns the public Sentry config the browser needs to initialize the SDK.
// DSN is intentionally exposed (Sentry DSNs are public by design).
// When the flag is off OR DSN is unset, returns { enabled: false } so the
// client init script can short-circuit without any network noise.

const { getFlag } = require('./_lib/flags');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Content-Type', 'application/json');

  let enabled;
  try {
    enabled = await getFlag('sentry_enabled', false);
  } catch {
    enabled = false;
  }

  const dsn = process.env.SENTRY_DSN || null;
  if (!enabled || !dsn) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ enabled: false }));
  }

  let environment = 'development';
  if (process.env.VERCEL_ENV === 'production') environment = 'production';
  else if (process.env.VERCEL_ENV === 'preview') environment = 'preview';

  const release =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.npm_package_version ||
    'unknown';

  res.statusCode = 200;
  return res.end(
    JSON.stringify({
      enabled: true,
      dsn,
      environment,
      release,
    })
  );
};
