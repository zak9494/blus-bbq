'use strict';

// Returns the set of Gmail accounts allowed to connect.
// Source: ALLOWED_GMAIL_ACCOUNTS env var (comma-separated).
// Falls back to the original single account if unset so prod is not broken.
function getAllowedAccounts() {
  const raw = process.env.ALLOWED_GMAIL_ACCOUNTS || 'info@blusbarbeque.com';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAllowedAccount(email) {
  return getAllowedAccounts().includes((email || '').toLowerCase().trim());
}

module.exports = { getAllowedAccounts, isAllowedAccount };
