/* ===== MODULE: PIPELINE ALERTS (C16)
   File: static/js/pipeline-alerts.js
   Loaded by: index.html <script src="/static/js/pipeline-alerts.js">
   Depends on: window.INQ_SECRET, window.openInquiry, window.showPage
   Exposes: window.pipelineAlertsInit()
   Renders dynamic rule-based alerts into #alerts-section.
   Alert types: past_due (high), unpaid_bal (high), stale_reply (med), upcoming_48h (med)
   ===== */
(function () {
  'use strict';

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  var TYPE_CONFIG = {
    past_due:     { icon: '🔴', cls: 'alert-urgent', action: 'Review →' },
    unpaid_bal:   { icon: '💰', cls: 'alert-urgent', action: 'Open →' },
    stale_reply:  { icon: '🟡', cls: 'alert-warn',   action: 'Reply →' },
    upcoming_48h: { icon: '📅', cls: 'alert-warn',   action: 'View →' },
  };

  function renderAlerts(el, alerts) {
    if (!alerts || alerts.length === 0) {
      el.style.display = 'none';
      return;
    }

    el.innerHTML = alerts.map(function (a) {
      var cfg = TYPE_CONFIG[a.type] || { icon: '•', cls: 'alert-warn', action: 'Open →' };
      var label = a.label ? '<strong style="margin-right:4px">' + escHtml(a.label) + '</strong>' : '';
      var tid = a.threadId ? escHtml(a.threadId) : '';
      var actionHtml = tid
        ? '<span class="alert-action" onclick="showPage(\'inquiries\');openInquiry(\'' + tid + '\')">' + cfg.action + '</span>'
        : '';
      return '<div class="alert ' + cfg.cls + '">' +
        '<span>' + cfg.icon + ' ' + label + escHtml(a.message || '') + '</span>' +
        actionHtml +
        '</div>';
    }).join('');

    el.style.display = 'block';
  }

  function updateBadge(count) {
    // Sync with notif-badge if present; only overwrite when we have a definitive count
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    }
    // Do not hide the badge — unreviewed-update count may have set it already
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.pipelineAlertsInit = async function () {
    var el = document.getElementById('alerts-section');
    if (!el) return;

    // Show loading state
    el.innerHTML = '<div class="alert" style="opacity:0.5;font-size:12px">Loading alerts…</div>';
    el.style.display = 'block';

    try {
      var url = '/api/pipeline/alerts?secret=' + encodeURIComponent(getSecret());
      var r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var alerts = d.alerts || [];
      renderAlerts(el, alerts);
      updateBadge(alerts.length);
    } catch (e) {
      el.style.display = 'none';
      console.warn('[pipeline-alerts] fetch failed:', e.message);
    }
  };

})();
