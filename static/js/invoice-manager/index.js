/* ===== MODULE: INVOICE MANAGER — index.js
   Exposes: window.invoiceMgr = { init }

   Responsibilities:
   1. Render the sales summary panel into #pipeline-sales-panel and
      hide the legacy count tiles (#pipeline-stats-legacy) when
      sales_panel_v1 flag is ON.
   2. Show / hide the Accounting nav section when invoice_manager_v1
      flag is ON.
   3. Fetch /api/invoices/summary for the selected time range and
      render the four financial tiles.

   Date-picker integration:
   TODO: When static/js/components/date-picker/ ships, replace the
   native <input type="date"> Custom row with the unified date-picker
   component. Import: window.datePicker.open({ onRange: callback }).
   ===== */
(function () {
  'use strict';

  var _range = 'this_month';
  var _customFrom = '';
  var _customTo   = '';
  var _loading = false;

  var RANGE_LABELS = [
    { key: 'this_month', label: 'This Month' },
    { key: 'ytd',        label: 'YTD' },
    { key: 'last_week',  label: 'Last Week' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'custom',     label: 'Custom' },
  ];

  function fmtDollar(n) {
    if (typeof n !== 'number' || isNaN(n)) return '$0';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  /* ── Fetch summary from API ───────────────────────────────────────────── */
  function fetchSummary(onDone) {
    var qs = '';
    if (_range === 'custom' && _customFrom && _customTo) {
      qs = '?from=' + encodeURIComponent(_customFrom) + '&to=' + encodeURIComponent(_customTo);
    } else {
      qs = '?period=' + encodeURIComponent(_range);
    }

    var secret = (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
    if (secret) qs += '&secret=' + encodeURIComponent(secret);

    fetch('/api/invoices/summary' + qs, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) { onDone(null, data); })
      .catch(function (err) { onDone(err, null); });
  }

  /* ── Render panel HTML ────────────────────────────────────────────────── */
  function renderPanel(root, data) {
    var pastDue = (data && typeof data.pastDue === 'number') ? data.pastDue : 0;
    var unpaid  = (data && typeof data.unpaid  === 'number') ? data.unpaid  : 0;
    var charged = (data && typeof data.charged === 'number') ? data.charged : 0;
    var paid    = (data && typeof data.paid    === 'number') ? data.paid    : 0;
    var isEmpty = !data || data._empty;

    var rangeBtns = RANGE_LABELS.map(function (r) {
      return '<button class="sales-range-btn' + (r.key === _range ? ' active' : '') +
        '" data-range="' + r.key + '" onclick="window.invoiceMgr._setRange(\'' + r.key + '\')">' +
        r.label + '</button>';
    }).join('');

    var customRow = '<div class="sales-custom-row' + (_range === 'custom' ? ' visible' : '') + '" id="sales-custom-row">' +
      '<label>From</label>' +
      '<input type="date" id="sales-from-input" value="' + (_customFrom || '') + '">' +
      '<label>To</label>' +
      '<input type="date" id="sales-to-input" value="' + (_customTo || '') + '">' +
      '<button class="btn-go" onclick="window.invoiceMgr._applyCustom()">Apply</button>' +
      '</div>';

    var tiles = [
      { label: 'Past Due $',  val: fmtDollar(pastDue), color: 'red',   sub: 'overdue invoices' },
      { label: 'Unpaid $',    val: fmtDollar(unpaid),  color: 'amber', sub: 'outstanding balance' },
      { label: 'Charges $',   val: fmtDollar(charged), color: 'blue',  sub: 'total invoiced' },
      { label: 'Paid $',      val: fmtDollar(paid),    color: 'green', sub: 'collected' },
    ].map(function (t) {
      return '<div class="sales-stat-card">' +
        '<div class="sales-stat-label">' + t.label + '</div>' +
        '<div class="sales-stat-val ' + t.color + '">' + (isEmpty ? '$—' : t.val) + '</div>' +
        '<div class="sales-stat-sub">' + t.sub + '</div>' +
        '</div>';
    }).join('');

    var notice = isEmpty
      ? '<div class="sales-empty-notice">Best-effort from quote data · Stripe/Square invoice data pending</div>'
      : '';

    root.innerHTML =
      '<div class="sales-panel">' +
        '<div class="sales-range-bar" id="sales-range-bar">' + rangeBtns + '</div>' +
        customRow +
        '<div class="sales-stat-grid" id="sales-stat-grid">' + tiles + '</div>' +
        '<div class="sales-view-all-row">' +
          '<button class="sales-view-all-btn" id="sales-view-all-btn" onclick="window.showPage && window.showPage(\'invoices\')">' +
            'View All Invoices →' +
          '</button>' +
        '</div>' +
        notice +
      '</div>';
  }

  /* ── Refresh: fetch + re-render ───────────────────────────────────────── */
  function refresh() {
    var root = document.getElementById('pipeline-sales-panel');
    if (!root || _loading) return;
    _loading = true;

    var grid = document.getElementById('sales-stat-grid');
    if (grid) grid.style.opacity = '0.5';

    fetchSummary(function (err, data) {
      _loading = false;
      if (grid) grid.style.opacity = '';
      if (err || !data) return;
      renderPanel(root, data);
    });
  }

  /* ── Public: set range preset ─────────────────────────────────────────── */
  function _setRange(key) {
    _range = key;
    var root = document.getElementById('pipeline-sales-panel');
    if (!root) return;

    root.querySelectorAll('.sales-range-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-range') === key);
    });

    var customRow = document.getElementById('sales-custom-row');
    if (customRow) customRow.classList.toggle('visible', key === 'custom');

    if (key !== 'custom') refresh();
  }

  /* ── Public: apply custom date range ─────────────────────────────────── */
  function _applyCustom() {
    var fromEl = document.getElementById('sales-from-input');
    var toEl   = document.getElementById('sales-to-input');
    if (!fromEl || !toEl) return;
    _customFrom = fromEl.value;
    _customTo   = toEl.value;
    if (_customFrom && _customTo) refresh();
  }

  /* ── Init ─────────────────────────────────────────────────────────────── */
  function init() {
    var flags = window.flags;
    if (!flags) return;

    var salesOn   = flags.isEnabled('sales_panel_v1');
    var invoiceOn = flags.isEnabled('invoice_manager_v1');

    // Sales panel
    var legacyPanel = document.getElementById('pipeline-stats-legacy');
    var salesPanel  = document.getElementById('pipeline-sales-panel');
    if (salesPanel) {
      if (salesOn) {
        if (legacyPanel) legacyPanel.style.display = 'none';
        salesPanel.style.display = '';
        renderPanel(salesPanel, null);
        fetchSummary(function (err, data) {
          if (!err && data) renderPanel(salesPanel, data);
        });
      } else {
        salesPanel.style.display = 'none';
        if (legacyPanel) legacyPanel.style.display = '';
      }
    }

    // Accounting nav + Invoice Manager nav item
    var accLabel   = document.getElementById('nav-accounting-label');
    var navInv     = document.getElementById('nav-invoices-active');
    var navInvStub = document.getElementById('nav-invoices-stub');
    if (invoiceOn) {
      if (accLabel)   accLabel.style.display   = '';
      if (navInv)     navInv.style.display     = '';
      if (navInvStub) navInvStub.style.display = 'none';
    } else {
      if (accLabel)   accLabel.style.display   = 'none';
      if (navInv)     navInv.style.display     = 'none';
      if (navInvStub) navInvStub.style.display = '';
    }
  }

  window.invoiceMgr = { init: init, _setRange: _setRange, _applyCustom: _applyCustom };
}());
