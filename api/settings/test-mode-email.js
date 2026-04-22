/* ===== SETTINGS: Test Mode Email
   GET  /api/settings/test-mode-email → { email: string | null }
   POST /api/settings/test-mode-email → body { secret, email } → { ok: true, email }
   ===== */
'use strict';
const { getTestModeEmail, setTestModeEmail } = require('../_lib/settings.js');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const email = await getTestModeEmail();
    return res.status(200).json({ email });
  }

  if (req.method === 'POST') {
    const expected = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN;
    const body = req.body || {};
    if (!expected || body.secret !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const email = (body.email || '').trim();
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    await setTestModeEmail(email);
    return res.status(200).json({ ok: true, email: email || null });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
