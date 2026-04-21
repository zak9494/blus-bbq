/**
 * inquiries-filters.js — Pure date-filter and status-filter predicates.
 * Extracted from index.html so these functions can be unit-tested in Node.js.
 * Exposed as globals in the browser; exported via module.exports in Node.js.
 */

/**
 * inqEventDateInRange — date-range predicate for the date-chip filters.
 *
 * @param {string}    filter      'all' | 'today' | 'week' | 'last-week' | 'month' | 'custom'
 * @param {Object}    inq         inquiry with email_date or updated_at
 * @param {Date|null} nowDate     injectable "now" (defaults to new Date() when null/undefined)
 * @param {Date|null} customStart custom range start (local midnight); only used when filter='custom'
 * @param {Date|null} customEnd   custom range end   (local midnight); only used when filter='custom'
 */
function inqEventDateInRange(filter, inq, nowDate, customStart, customEnd) {
  if (filter === 'all') return true;
  const ts = inq.email_date || inq.updated_at || '';
  if (!ts) return true;
  const received = new Date(ts);
  if (isNaN(received.getTime())) return true;
  const now   = nowDate || new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rDay  = new Date(received.getFullYear(), received.getMonth(), received.getDate());
  if (filter === 'today') return rDay.getTime() === today.getTime();
  if (filter === 'week') {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - ((dow + 6) % 7));
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    return rDay >= mon && rDay <= sun;
  }
  if (filter === 'last-week') {
    const dow            = today.getDay();
    const startThisWeek  = new Date(today); startThisWeek.setDate(today.getDate() - ((dow + 6) % 7));
    const startLastWeek  = new Date(startThisWeek); startLastWeek.setDate(startThisWeek.getDate() - 7);
    return rDay >= startLastWeek && rDay < startThisWeek;
  }
  if (filter === 'month') {
    return received.getFullYear() === today.getFullYear() &&
           received.getMonth()    === today.getMonth();
  }
  if (filter === 'custom') {
    const cs = customStart || null;
    const ce = customEnd   || null;
    if (!cs && !ce) return true;
    if (cs && rDay < cs) return false;
    if (ce && rDay > ce) return false;
    return true;
  }
  return true;
}

/**
 * isNeedsReview — matches the 'needs_review' status chip.
 * An inquiry needs review when it is not archived and not yet approved.
 */
function isNeedsReview(inq) {
  return inq.status !== 'archived' && !inq.approved;
}

if (typeof module !== 'undefined') {
  module.exports = { inqEventDateInRange, isNeedsReview };
}
