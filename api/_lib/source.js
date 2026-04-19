/**
 * api/_lib/source.js
 * Detects the source of a catering inquiry email.
 * Returns: 'wix' | 'ezcater' | 'direct'
 *
 * Priority: ezCater > Wix > Direct
 *
 * Wix:     subject contains "got a new submission" AND from contains "blusbarbeque.com"
 *          (Wix sends form notifications from the business email to itself)
 * ezCater: from/subject contains "ezcater"
 * Direct:  everything else
 */
function detectSource(from, subject) {
  const f = (from    || '').toLowerCase();
  const s = (subject || '').toLowerCase();

  // ezCater (highest priority — override wix if matched)
  if (f.includes('@ezcater.com') || f.includes('ezcater') || s.includes('ezcater')) return 'ezcater';

  // Wix form notification: FROM the business email with Wix-specific subject
  if ((s.includes('got a new submission') || s.includes('new catering inquiry') ||
       s.includes('new contact form submission')) &&
      f.includes('blusbarbeque.com')) return 'wix';

  return 'direct';
}

module.exports = { detectSource };
