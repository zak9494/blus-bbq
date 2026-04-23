/* ===== MODULE: todays-actions
   Wave 1 — Today's Actions dashboard widget.
   Feature flag: todays_actions_widget (default true).

   Reads from window.pipelineInqCache (set by loadPipelineInquiries).
   Renders into #todays-actions-container on the pipeline page.

   Exposes: window.todaysActions = { render, refresh }
   ===== */
(function () {
  'use strict';

  var CONTAINER_ID = 'todays-actions-container';

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      var p = d.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2])
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (_) { return d; }
  }

  function isEnabled() {
    return !window.flags || !window.flags.isEnabled || window.flags.isEnabled('todays_actions_widget');
  }

  /* ── Categorize inquiries from pipelineInqCache ── */

  function categorize() {
    var cache = window.pipelineInqCache || [];
    var today = todayStr();
    var overdue   = [];
    var events    = [];
    var drafts    = [];
    var approvals = [];

    cache.forEach(function (inq) {
      // Overdue follow-ups: customer replied and not yet addressed
      if (inq.has_unreviewed_update && inq.status !== 'archived') {
        overdue.push(inq);
      }
      // Today's events: booked events happening today
      if (inq.event_date === today && (inq.status === 'booked' || inq.status === 'in_progress')) {
        events.push(inq);
      }
      // AI draft reviews: quote drafted but not yet approved by user
      if (inq.status === 'quote_drafted' && !inq.approved) {
        drafts.push(inq);
      }
      // Pending quote approvals: quote sent, waiting for customer
      if (inq.status === 'quote_approved') {
        approvals.push(inq);
      }
    });

    return { overdue: overdue, events: events, drafts: drafts, approvals: approvals };
  }

  /* ── Row builder ── */

  function actionRow(icon, label, sub, dotClass, onClick) {
    var row = document.createElement('div');
    row.className = 'ta-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.innerHTML =
      '<span class="ta-dot' + (dotClass ? ' ' + dotClass : '') + '"></span>'
      + '<span class="ta-icon">' + icon + '</span>'
      + '<span class="ta-text"><span class="ta-label">' + label + '</span>'
        + (sub ? '<span class="ta-sub">' + sub + '</span>' : '')
      + '</span>'
      + '<span class="ta-arrow">›</span>';
    row.addEventListener('click', onClick);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    });
    return row;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Main render ── */

  function render() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    if (!isEnabled()) {
      container.style.display = 'none';
      return;
    }

    var cats = categorize();
    var total = cats.overdue.length + cats.events.length + cats.drafts.length + cats.approvals.length;

    if (total === 0) {
      container.style.display = 'block';
      container.innerHTML =
        '<div class="ta-card">'
        + '<div class="ta-header">Today\'s Actions</div>'
        + '<div class="ta-empty">All clear for today \uD83C\uDF56</div>'
        + '</div>';
      return;
    }

    var card = document.createElement('div');
    card.className = 'ta-card';

    var hdr = document.createElement('div');
    hdr.className = 'ta-header';
    hdr.textContent = "Today's Actions";
    card.appendChild(hdr);

    var body = document.createElement('div');
    body.className = 'ta-body';

    // Overdue follow-ups
    cats.overdue.forEach(function (inq) {
      var name = escHtml(inq.customer_name || inq.from || 'Unknown');
      body.appendChild(actionRow(
        '💬', name + ' replied',
        'Needs your response',
        'ta-dot-red',
        function () { navigateTo(inq.threadId); }
      ));
    });

    // Today's booked events
    cats.events.forEach(function (inq) {
      var name = escHtml(inq.customer_name || inq.from || 'Unknown');
      var guests = inq.guest_count ? ' \u00b7 ' + inq.guest_count + ' guests' : '';
      body.appendChild(actionRow(
        '🍖', name,
        'Event today' + guests,
        'ta-dot-green',
        function () { navigateTo(inq.threadId); }
      ));
    });

    // AI draft reviews
    if (cats.drafts.length > 0) {
      var draftLabel = cats.drafts.length === 1
        ? escHtml((cats.drafts[0].customer_name || cats.drafts[0].from || 'Unknown')) + ' — quote ready'
        : cats.drafts.length + ' quotes need your review';
      body.appendChild(actionRow(
        '📝', draftLabel,
        cats.drafts.length === 1 ? 'AI draft — tap to review' : 'Tap to review AI drafts',
        'ta-dot-amber',
        function () {
          if (cats.drafts.length === 1) {
            navigateTo(cats.drafts[0].threadId);
          } else {
            if (typeof showPage === 'function') showPage('inquiries');
          }
        }
      ));
    }

    // Pending quote approvals
    if (cats.approvals.length > 0) {
      var appLabel = cats.approvals.length === 1
        ? escHtml((cats.approvals[0].customer_name || cats.approvals[0].from || 'Unknown'))
        : cats.approvals.length + ' quotes awaiting customer';
      body.appendChild(actionRow(
        '⏳', appLabel,
        'Waiting on customer approval',
        'ta-dot-blue',
        function () {
          if (cats.approvals.length === 1) {
            navigateTo(cats.approvals[0].threadId);
          } else {
            if (typeof showPage === 'function') showPage('inquiries');
          }
        }
      ));
    }

    card.appendChild(body);
    container.innerHTML = '';
    container.appendChild(card);
    container.style.display = 'block';
  }

  function navigateTo(threadId) {
    if (typeof showPage === 'function') showPage('inquiries');
    if (typeof openInquiry === 'function') openInquiry(threadId);
  }

  function refresh() {
    render();
  }

  window.todaysActions = { render: render, refresh: refresh };
}());
