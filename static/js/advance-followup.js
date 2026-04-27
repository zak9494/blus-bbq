/* ===== MODULE: ADVANCE FOLLOW-UP CALENDAR (Wave 3, advance_followup_v1)
   Far-future booking follow-up surface.

   Lists inquiries with event_date > today + AF_THRESHOLD_DAYS, sorted ascending
   by event date. Each row exposes a date input for `next_followup_at`. Saving
   posts to /api/inquiries/save with the existing GMAIL_READ_SECRET-equivalent
   secret pattern (we proxy via /api/inquiries/save with body.secret = the
   self-modify secret if available; otherwise the user is read-only).

   Public surface:
     window.advanceFollowup = {
       init,                    // call once when page is opened
       render,                  // re-render from current cache
       AF_THRESHOLD_DAYS,       // configurable threshold (default 30)
     };
   ===== */
(function () {
  'use strict';

  var AF_THRESHOLD_DAYS = 30;
  var _inquiries = null;
  var _loading   = false;
  var _saveErr   = null;
  var _initOnce  = false;

  // Advance follow-up rows hide statuses that no longer need attention.
  // Only "active" pipeline statuses surface (booked, quote_sent, quote_approved,
  // quote_drafted, needs_info, new). Completed/declined/archived are excluded.
  var ACTIVE_STATUSES = new Set([
    'new', 'needs_info', 'quote_drafted', 'quote_approved',
    'quote_sent', 'booked', 'in_progress',
  ]);

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    // Accept "YYYY-MM-DD" or full ISO.
    var d = new Date(iso.length === 10 ? (iso + 'T12:00:00') : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  function todayIsoDate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysFromToday(iso) {
    if (!iso) return null;
    var ev = new Date(iso.length === 10 ? (iso + 'T12:00:00') : iso);
    if (isNaN(ev.getTime())) return null;
    var now = new Date();
    var ms  = ev.getTime() - now.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  function isFarFuture(inq) {
    var d = daysFromToday(inq.event_date);
    return d != null && d > AF_THRESHOLD_DAYS;
  }

  function isActiveStatus(inq) {
    return ACTIVE_STATUSES.has(inq.status || 'new');
  }

  async function loadInquiries() {
    _loading = true;
    render();
    try {
      var r = await fetch('/api/inquiries/list', { cache: 'no-store' });
      var d = await r.json();
      _inquiries = Array.isArray(d.inquiries) ? d.inquiries : [];
    } catch (e) {
      _inquiries = [];
    } finally {
      _loading = false;
      render();
    }
  }

  function getRows() {
    if (!Array.isArray(_inquiries)) return [];
    var rows = _inquiries
      .filter(isFarFuture)
      .filter(isActiveStatus)
      .slice();
    rows.sort(function (a, b) {
      var da = a.event_date ? new Date(a.event_date.length === 10 ? (a.event_date + 'T12:00:00') : a.event_date).getTime() : 0;
      var db = b.event_date ? new Date(b.event_date.length === 10 ? (b.event_date + 'T12:00:00') : b.event_date).getTime() : 0;
      return da - db;
    });
    return rows;
  }

  function rowHtml(inq) {
    var name = inq.customer_name || inq.from || '(no name)';
    var ev   = fmtDate(inq.event_date);
    var days = daysFromToday(inq.event_date);
    var status = inq.status || 'new';
    var followInputVal = inq.next_followup_at
      ? String(inq.next_followup_at).slice(0, 10)
      : '';
    var fmtFollow = inq.next_followup_at ? fmtDate(inq.next_followup_at) : '';
    return ''
      + '<div class="af-row" data-thread-id="' + escapeHtml(inq.threadId) + '">'
      + '  <div class="af-row-main">'
      + '    <div class="af-row-name">' + escapeHtml(name) + '</div>'
      + '    <div class="af-row-meta">'
      + '      <span class="af-event-date">' + escapeHtml(ev) + '</span>'
      + '      <span class="af-days-out">' + (days != null ? (days + ' days out') : '') + '</span>'
      + '      <span class="af-status af-status-' + escapeHtml(status) + '">' + escapeHtml(status.replace(/_/g, ' ')) + '</span>'
      + '    </div>'
      + '  </div>'
      + '  <div class="af-row-followup">'
      + '    <label class="af-followup-label">Follow up on</label>'
      + '    <input type="date" class="af-followup-input" '
      +        'data-thread-id="' + escapeHtml(inq.threadId) + '" '
      +        'min="' + todayIsoDate() + '" '
      +        'value="' + escapeHtml(followInputVal) + '" />'
      + '    <button class="af-save-btn btn btn-sm" '
      +        'data-thread-id="' + escapeHtml(inq.threadId) + '">Save</button>'
      + '    <span class="af-current-follow"' + (fmtFollow ? '' : ' style="display:none"') + '>'
      +      'Currently: <strong>' + escapeHtml(fmtFollow) + '</strong>'
      + '    </span>'
      + '    <span class="af-save-status" data-thread-id="' + escapeHtml(inq.threadId) + '"></span>'
      + '  </div>'
      + '</div>';
  }

  function render() {
    var root = el('af-page-body');
    if (!root) return;

    if (_loading) {
      root.innerHTML = '<div class="af-empty">Loading far-future bookings…</div>';
      return;
    }

    var rows = getRows();

    var headerHtml = ''
      + '<div class="af-summary">'
      +   '<strong>' + rows.length + '</strong> ' + (rows.length === 1 ? 'booking' : 'bookings')
      +   ' more than ' + AF_THRESHOLD_DAYS + ' days out'
      + '</div>';

    if (_saveErr) {
      headerHtml += '<div class="af-error">' + escapeHtml(_saveErr) + '</div>';
    }

    if (rows.length === 0) {
      root.innerHTML = headerHtml
        + '<div class="af-empty">'
        +   '<div class="af-empty-title">No far-future bookings yet</div>'
        +   '<div class="af-empty-sub">Inquiries with event dates more than '
        +     AF_THRESHOLD_DAYS + ' days out will appear here. '
        +     'Use this page to set light-touch follow-up dates well before the event.'
        +   '</div>'
        + '</div>';
      return;
    }

    root.innerHTML = headerHtml
      + '<div class="af-list">'
      +   rows.map(rowHtml).join('')
      + '</div>';

    // Wire save buttons.
    var btns = root.querySelectorAll('.af-save-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', onSaveClick);
    });
  }

  async function onSaveClick(ev) {
    var btn = ev.currentTarget;
    var threadId = btn.getAttribute('data-thread-id');
    var input = document.querySelector('.af-followup-input[data-thread-id="' + cssEsc(threadId) + '"]');
    var statusEl = document.querySelector('.af-save-status[data-thread-id="' + cssEsc(threadId) + '"]');
    if (!input || !statusEl) return;

    var rawVal = (input.value || '').trim();
    // Empty value means "clear" — send null.
    var nextVal = rawVal === '' ? null : rawVal;

    statusEl.textContent = 'Saving…';
    statusEl.className   = 'af-save-status af-saving';

    var ok = await saveFollowup(threadId, nextVal);
    if (ok) {
      statusEl.textContent = 'Saved';
      statusEl.className   = 'af-save-status af-saved';
      // Update local cache so a re-render shows the new value.
      var i = (_inquiries || []).findIndex(function (q) { return q.threadId === threadId; });
      if (i >= 0) _inquiries[i].next_followup_at = nextVal;
      // Refresh just the "currently" badge for this row without full re-render.
      var row = document.querySelector('.af-row[data-thread-id="' + cssEsc(threadId) + '"] .af-current-follow');
      if (row) {
        if (nextVal) {
          row.innerHTML = 'Currently: <strong>' + escapeHtml(fmtDate(nextVal)) + '</strong>';
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      }
      setTimeout(function () {
        if (statusEl.textContent === 'Saved') statusEl.textContent = '';
      }, 2500);
    } else {
      statusEl.textContent = 'Save failed';
      statusEl.className   = 'af-save-status af-save-err';
    }
  }

  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  async function saveFollowup(threadId, nextFollowupAt) {
    try {
      var body = {
        threadId: threadId,
        next_followup_at: nextFollowupAt,
        history_entry: {
          action: nextFollowupAt
            ? ('followup_set_' + nextFollowupAt)
            : 'followup_cleared',
          actor: 'user',
        },
      };
      var r = await fetch('/api/inquiries/save?secret=' + encodeURIComponent(getSecret()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) { _saveErr = null; return true; }
      var t = await r.text().catch(function () { return ''; });
      _saveErr = 'Save failed (' + r.status + '): ' + t.slice(0, 160);
      return false;
    } catch (e) {
      _saveErr = 'Save failed: ' + (e && e.message ? e.message : 'network error');
      return false;
    }
  }

  function init() {
    if (_initOnce) {
      // Subsequent visits: refresh quietly.
      loadInquiries();
      return;
    }
    _initOnce = true;
    loadInquiries();
  }

  window.advanceFollowup = {
    init: init,
    render: render,
    AF_THRESHOLD_DAYS: AF_THRESHOLD_DAYS,
  };
})();
