/* ===== MODULE: lost-reasons-widget
   Feature flag: lost_reasons_v1 (default OFF).

   Renders a "Lost Reasons" card on the pipeline dashboard showing:
   - Total Lost count + total Lost dollar amount
   - Bar chart breakdown by reason for a configurable date range

   Exposes: window.lostReasonsWidget = { init, refresh }
   ===== */
(function () {
  'use strict';

  var REASON_LABELS = {
    declined:             'Declined',
    no_response_customer: 'No Response (Customer)',
    no_response_us:       'No Response (Us)',
    out_of_range:         'Out of Range',
    booked_elsewhere:     'Booked Elsewhere',
    budget_mismatch:      'Budget Mismatch',
    other:                'Other',
    auto_archive_post_event: 'Auto-archived (Past Event)',
  };

  var RANGE_OPTIONS = [
    { label: '30d', days: 30 },
    { label: '60d', days: 60 },
    { label: '90d', days: 90 },
    { label: 'YTD', days: null },
  ];

  var _container = null;
  var _days      = 30;
  var _loaded    = false;

  function isEnabled() {
    return !!(window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('lost_reasons_v1'));
  }

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function fmtMoney(n) {
    if (!n && n !== 0) return '$0';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function getFromDate(days) {
    var d = new Date();
    if (days === null) {
      // YTD
      d.setMonth(0); d.setDate(1); d.setHours(0,0,0,0);
    } else {
      d.setDate(d.getDate() - days);
    }
    return d.toISOString().slice(0, 10);
  }

  function buildBar(label, count, amount, pct, maxPct) {
    var barWidth = maxPct > 0 ? Math.round((pct / maxPct) * 100) : 0;
    return '<div class="lrw-row">'
      + '<div class="lrw-row-label">' + label + '</div>'
      + '<div class="lrw-row-bar-wrap">'
        + '<div class="lrw-row-bar" style="width:' + barWidth + '%"></div>'
      + '</div>'
      + '<div class="lrw-row-stats">'
        + '<span class="lrw-row-count">' + count + '</span>'
        + '<span class="lrw-row-pct">(' + pct + '%)</span>'
        + (amount > 0 ? '<span class="lrw-row-amt">' + fmtMoney(amount) + '</span>' : '')
      + '</div>'
    + '</div>';
  }

  function render(data) {
    if (!_container) return;

    var byReason = data.by_reason || {};
    var reasons  = Object.keys(byReason).sort(function (a, b) {
      return byReason[b].count - byReason[a].count;
    });
    var maxPct = reasons.reduce(function (m, k) {
      return Math.max(m, byReason[k].pct);
    }, 0);

    var rangeHtml = RANGE_OPTIONS.map(function (opt) {
      var active = (_days === opt.days) ? ' lrw-range-active' : '';
      return '<button class="lrw-range-btn' + active + '" data-days="' + (opt.days === null ? 'ytd' : opt.days) + '">'
        + opt.label + '</button>';
    }).join('');

    var barsHtml = reasons.length === 0
      ? '<div class="lrw-empty">No Lost entries in this period.</div>'
      : reasons.map(function (k) {
          var v = byReason[k];
          return buildBar(REASON_LABELS[k] || k, v.count, v.amount, v.pct, maxPct);
        }).join('');

    _container.innerHTML =
      '<div class="lrw-card">'
        + '<div class="lrw-header">'
          + '<div class="lrw-title">&#128683; Lost Reasons</div>'
          + '<div class="lrw-range">' + rangeHtml + '</div>'
        + '</div>'
        + '<div class="lrw-totals">'
          + '<div class="lrw-total-item"><span class="lrw-total-val">' + data.total_count + '</span><span class="lrw-total-lbl">Lost</span></div>'
          + '<div class="lrw-total-item"><span class="lrw-total-val">' + fmtMoney(data.total_amount) + '</span><span class="lrw-total-lbl">Pipeline Lost</span></div>'
        + '</div>'
        + '<div class="lrw-bars">' + barsHtml + '</div>'
      + '</div>';

    _container.querySelectorAll('.lrw-range-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var val = btn.getAttribute('data-days');
        _days = val === 'ytd' ? null : parseInt(val, 10);
        _load();
      });
    });
  }

  function renderError(msg) {
    if (!_container) return;
    _container.innerHTML = '<div class="lrw-card lrw-error">'
      + '<div class="lrw-title">Lost Reasons</div>'
      + '<div class="lrw-empty">' + msg + '</div></div>';
  }

  function renderLoading() {
    if (!_container) return;
    _container.innerHTML = '<div class="lrw-card lrw-loading">'
      + '<div class="lrw-title">Lost Reasons</div>'
      + '<div class="lrw-empty">Loading\u2026</div></div>';
  }

  function _load() {
    if (!_container || !isEnabled()) return;
    renderLoading();
    var from = getFromDate(_days);
    var url = '/api/invoices/lost-reasons?secret=' + encodeURIComponent(getSecret())
      + '&from=' + encodeURIComponent(from);
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { renderError(d.error); return; }
        render(d);
      })
      .catch(function (e) { renderError('Failed to load: ' + e.message); });
  }

  function init(containerId) {
    if (!isEnabled()) return;
    _container = document.getElementById(containerId || 'lost-reasons-widget-container');
    if (!_container) return;
    _container.style.display = '';
    if (!_loaded) { _loaded = true; _load(); }
  }

  function refresh() {
    if (!isEnabled() || !_container) return;
    _load();
  }

  window.lostReasonsWidget = { init: init, refresh: refresh };
}());
