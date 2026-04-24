/* ===== MODULE: INVOICE MANAGER — index.js
   Exposes: window.invoiceMgr = { init, initPage, openCreate, openRecordPayment,
                                   _setRange, _applyCustom }

   Responsibilities:
   1. Sales summary panel in pipeline page (#pipeline-sales-panel) — sales_panel_v1 flag.
   2. Accounting nav show/hide — invoice_manager_v1 flag.
   3. Full Invoice Manager page (#page-invoices) — list, filters, table, modals.

   Date-picker:
   TODO: Replace native <input type="date"> with window.datePicker.open() when
   static/js/components/date-picker/ ships.
   ===== */
(function () {
  'use strict';

  // ─── Sales-panel state ────────────────────────────────────────────────────
  var _spRange      = 'this_month';
  var _spCustomFrom = '';
  var _spCustomTo   = '';
  var _spLoading    = false;

  var RANGE_LABELS = [
    { key: 'this_month', label: 'This Month' },
    { key: 'quarter',    label: 'Quarter'    },
    { key: 'ytd',        label: 'YTD'        },
    { key: 'last_month', label: 'Last Month' },
    { key: 'custom',     label: 'Custom'     },
  ];

  // ─── Invoice-page state ───────────────────────────────────────────────────
  var _invFilters = {
    from: '', to: '', status: [], service: [],
    minAmount: '', maxAmount: '', search: '',
    unpaidOnly: false, pastDueOnly: false,
  };
  var _invPage     = 0;
  var _invPageSize = 50;
  var _invTotal    = 0;
  var _invRows     = [];
  var _invSelected = {};   // id → true
  var _invLoading  = false;
  var _invSummary  = null;
  var _invRange    = 'this_month';
  var _invCustomFrom = '', _invCustomTo = '';

  // Payment modal state
  var _payInvId    = null;
  var _payStep     = 1;
  var _payMethod   = null;

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function fmtDollar(n) {
    if (typeof n !== 'number' || isNaN(n)) return '$0';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtDollar2(n) {
    if (typeof n !== 'number' || isNaN(n)) return '$0.00';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getSecret() {
    return (typeof window.SELF_MODIFY_SECRET !== 'undefined' ? window.SELF_MODIFY_SECRET : '') || '';
  }

  function apiGet(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    body.secret = getSecret();
    return fetch(path, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  // ─── STATUS BADGE ─────────────────────────────────────────────────────────
  var STATUS_META = {
    draft:    { label: 'Draft',    cls: 'inv-badge-draft'    },
    sent:     { label: 'Sent',     cls: 'inv-badge-sent'     },
    partial:  { label: 'Partial',  cls: 'inv-badge-partial'  },
    paid:     { label: 'Paid',     cls: 'inv-badge-paid'     },
    past_due: { label: 'Past Due', cls: 'inv-badge-pastdue'  },
    void:     { label: 'Void',     cls: 'inv-badge-void'     },
    refunded: { label: 'Refunded', cls: 'inv-badge-refunded' },
  };

  function statusBadge(status) {
    var m = STATUS_META[status] || { label: status, cls: 'inv-badge-draft' };
    return '<span class="inv-status-badge ' + m.cls + '">' + m.label + '</span>';
  }

  // ─── PAYMENT METHOD ICON ──────────────────────────────────────────────────
  var METHOD_ICON = {
    check:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    cash:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    venmo:   '<span style="font-weight:800;font-size:18px;color:#3D95CE;font-family:sans-serif">V</span>',
    zelle:   '<span style="font-weight:800;font-size:18px;color:#6D1ED4;font-family:sans-serif">Z</span>',
    cashapp: '<span style="font-weight:800;font-size:18px;color:#00D632;font-family:sans-serif">$</span>',
    paypal:  '<span style="font-weight:800;font-size:18px;color:#003087;font-family:sans-serif">P</span>',
    other:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };

  function methodSourceIcon(method) {
    return '<span class="inv-method-icon" title="' + (method || '') + '">' + (METHOD_ICON[method] || '') + '</span>';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION A — SALES PANEL (pipeline page)
  // ══════════════════════════════════════════════════════════════════════════

  function spFetchSummary(onDone) {
    var qs = _spRange === 'custom' && _spCustomFrom && _spCustomTo
      ? '?from=' + encodeURIComponent(_spCustomFrom) + '&to=' + encodeURIComponent(_spCustomTo)
      : '?period=' + encodeURIComponent(_spRange);
    fetch('/api/invoices/summary' + qs, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) { onDone(null, d); })
      .catch(function (e) { onDone(e, null); });
  }

  function spRenderPanel(root, data) {
    var pastDue = data && typeof data.pastDue === 'number' ? data.pastDue : 0;
    var unpaid  = data && typeof data.unpaid  === 'number' ? data.unpaid  : 0;
    var charged = data && typeof data.charged === 'number' ? data.charged : 0;
    var paid    = data && typeof data.paid    === 'number' ? data.paid    : 0;
    var empty   = !data || data._empty;

    var btns = RANGE_LABELS.map(function (r) {
      return '<button class="sales-range-btn' + (r.key === _spRange ? ' active' : '') +
        '" data-range="' + r.key + '" onclick="window.invoiceMgr._setRange(\'' + r.key + '\')">' +
        r.label + '</button>';
    }).join('');

    var customRow =
      '<div class="sales-custom-row' + (_spRange === 'custom' ? ' visible' : '') + '" id="sales-custom-row">' +
        '<label>From</label>' +
        '<input type="date" id="sales-from-input" value="' + _spCustomFrom + '">' +
        '<label>To</label>' +
        '<input type="date" id="sales-to-input" value="' + _spCustomTo + '">' +
        '<button class="btn-go" onclick="window.invoiceMgr._applyCustom()">Apply</button>' +
      '</div>';

    var tiles = [
      { label: 'Past Due $', val: fmtDollar(pastDue), color: 'red',   sub: 'overdue invoices' },
      { label: 'Unpaid $',   val: fmtDollar(unpaid),  color: 'amber', sub: 'outstanding balance' },
      { label: 'Charges $',  val: fmtDollar(charged), color: 'blue',  sub: 'total invoiced' },
      { label: 'Paid $',     val: fmtDollar(paid),    color: 'green', sub: 'collected' },
    ].map(function (t) {
      return '<div class="sales-stat-card">' +
        '<div class="sales-stat-label">' + t.label + '</div>' +
        '<div class="sales-stat-val ' + t.color + '">' + (empty ? '$—' : t.val) + '</div>' +
        '<div class="sales-stat-sub">' + t.sub + '</div>' +
        '</div>';
    }).join('');

    var notice = empty
      ? '<div class="sales-empty-notice">Best-effort from quote data · Invoice data pending</div>'
      : '';

    root.innerHTML =
      '<div class="sales-panel">' +
        '<div class="sales-range-bar">' + btns + '</div>' +
        customRow +
        '<div class="sales-stat-grid" id="sales-stat-grid">' + tiles + '</div>' +
        '<div class="sales-view-all-row">' +
          '<button class="sales-view-all-btn" onclick="window.showPage && window.showPage(\'invoices\')">' +
            'View All Invoices →' +
          '</button>' +
        '</div>' +
        notice +
      '</div>';
  }

  function spRefresh() {
    var root = document.getElementById('pipeline-sales-panel');
    if (!root || _spLoading) return;
    _spLoading = true;
    var grid = document.getElementById('sales-stat-grid');
    if (grid) grid.style.opacity = '0.5';
    spFetchSummary(function (err, data) {
      _spLoading = false;
      if (grid) grid.style.opacity = '';
      if (!err && data) spRenderPanel(root, data);
    });
  }

  function _setRange(key) {
    _spRange = key;
    var root = document.getElementById('pipeline-sales-panel');
    if (!root) return;
    root.querySelectorAll('.sales-range-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-range') === key);
    });
    var cr = document.getElementById('sales-custom-row');
    if (cr) cr.classList.toggle('visible', key === 'custom');
    if (key !== 'custom') spRefresh();
  }

  function _applyCustom() {
    var f = document.getElementById('sales-from-input');
    var t = document.getElementById('sales-to-input');
    if (!f || !t) return;
    _spCustomFrom = f.value; _spCustomTo = t.value;
    if (_spCustomFrom && _spCustomTo) spRefresh();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION B — INVOICE PAGE
  // ══════════════════════════════════════════════════════════════════════════

  function invSummaryQs() {
    if (_invRange === 'custom' && _invCustomFrom && _invCustomTo) {
      return '?from=' + encodeURIComponent(_invCustomFrom) + '&to=' + encodeURIComponent(_invCustomTo);
    }
    return '?period=' + encodeURIComponent(_invRange);
  }

  function invLoadSummary() {
    var sec = document.getElementById('inv-summary-section');
    if (!sec) return;
    sec.innerHTML = '<div class="inv-loading-bar"></div>';
    apiGet('/api/invoices/summary' + invSummaryQs())
      .then(function (data) { _invSummary = data; invRenderSummary(data); })
      .catch(function ()    { _invSummary = null; invRenderSummary(null); });
  }

  function invRenderSummary(data) {
    var sec = document.getElementById('inv-summary-section');
    if (!sec) return;
    var d = data || {};
    var empty = !data || data._empty;

    var rangeBtns = RANGE_LABELS.map(function (r) {
      return '<button class="inv-range-btn' + (r.key === _invRange ? ' active' : '') +
        '" onclick="window.invoiceMgr._invSetRange(\'' + r.key + '\')">' + r.label + '</button>';
    }).join('');

    var customRow =
      '<div class="inv-custom-row' + (_invRange === 'custom' ? ' visible' : '') + '" id="inv-custom-row">' +
        '<label>From</label>' +
        '<input type="date" id="inv-sum-from" value="' + _invCustomFrom + '">' +
        '<label>To</label>' +
        '<input type="date" id="inv-sum-to" value="' + _invCustomTo + '">' +
        '<button class="btn-go" onclick="window.invoiceMgr._invApplyCustomSummary()">Apply</button>' +
      '</div>';

    var row1 = [
      { label: 'Charged',  val: fmtDollar(d.charged  || 0), color: 'blue',  sub: 'total invoiced'      },
      { label: 'Paid',     val: fmtDollar(d.paid     || 0), color: 'green', sub: 'collected'           },
      { label: 'Unpaid',   val: fmtDollar(d.unpaid   || 0), color: 'amber', sub: 'outstanding balance' },
      { label: 'Past Due', val: fmtDollar(d.pastDue  || 0), color: 'red',   sub: 'overdue'             },
    ].map(function (t) {
      return '<div class="sales-stat-card">' +
        '<div class="sales-stat-label">' + t.label + '</div>' +
        '<div class="sales-stat-val ' + t.color + '">' + (empty ? '$—' : t.val) + '</div>' +
        '<div class="sales-stat-sub">' + t.sub + '</div>' +
        '</div>';
    }).join('');

    var count    = d.invoiceCount || 0;
    var avgTick  = d.avgTicket    || 0;
    var lost     = d.lostDollars  || 0;

    var row2 = [
      { label: 'Lost $',      val: fmtDollar(lost),          color: 'red',   sub: 'declined quotes'  },
      { label: 'Avg Ticket',  val: avgTick ? fmtDollar(avgTick) : '$—', color: 'blue',  sub: 'per invoice'     },
      { label: '# Invoices',  val: count > 0 ? String(count) : '—',    color: '',      sub: 'in period'       },
    ].map(function (t) {
      return '<div class="sales-stat-card inv-stat-secondary">' +
        '<div class="sales-stat-label">' + t.label + '</div>' +
        '<div class="sales-stat-val ' + t.color + '">' + (empty && t.color ? '—' : t.val) + '</div>' +
        '<div class="sales-stat-sub">' + t.sub + '</div>' +
        '</div>';
    }).join('');

    var notice = (empty && !data)
      ? '<div class="sales-empty-notice">No invoices yet in this period. Create one to get started.</div>'
      : '';

    sec.innerHTML =
      '<div class="inv-summary-panel">' +
        '<div class="sales-range-bar">' + rangeBtns + '</div>' +
        customRow +
        '<div class="sales-stat-grid">' + row1 + '</div>' +
        '<div class="inv-stat-row2">' + row2 + '</div>' +
        notice +
      '</div>';
  }

  function _invSetRange(key) {
    _invRange = key;
    var cr = document.getElementById('inv-custom-row');
    if (cr) cr.classList.toggle('visible', key === 'custom');
    if (key !== 'custom') invLoadSummary();
  }

  function _invApplyCustomSummary() {
    var f = document.getElementById('inv-sum-from');
    var t = document.getElementById('inv-sum-to');
    if (!f || !t) return;
    _invCustomFrom = f.value; _invCustomTo = t.value;
    if (_invCustomFrom && _invCustomTo) invLoadSummary();
  }

  // ── Filter row ────────────────────────────────────────────────────────────
  var ALL_STATUSES  = ['draft','sent','partial','paid','past_due','void','refunded'];
  var ALL_SERVICES  = ['pickup','delivery','delivery_setup','delivery_setup_service'];
  var SERVICE_LABEL = {
    pickup: 'Pickup', delivery: 'Delivery',
    delivery_setup: 'Delivery+Setup', delivery_setup_service: 'Full Service',
  };

  function invRenderFilters() {
    var row = document.getElementById('inv-filters-row');
    if (!row) return;

    var statusOpts = ALL_STATUSES.map(function (s) {
      var m  = STATUS_META[s] || { label: s };
      var on = _invFilters.status.length === 0 || _invFilters.status.indexOf(s) >= 0;
      return '<label class="inv-filter-chip' + (on ? ' active' : '') + '" data-status="' + s + '">' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="window.invoiceMgr._filterStatus(\'' + s + '\',this.checked)">' +
        m.label + '</label>';
    }).join('');

    var serviceOpts = ALL_SERVICES.map(function (s) {
      var on = _invFilters.service.length === 0 || _invFilters.service.indexOf(s) >= 0;
      return '<label class="inv-filter-chip' + (on ? ' active' : '') + '" data-service="' + s + '">' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="window.invoiceMgr._filterService(\'' + s + '\',this.checked)">' +
        SERVICE_LABEL[s] + '</label>';
    }).join('');

    row.innerHTML =
      '<div class="inv-filters-wrap">' +
        '<div class="inv-filter-group">' +
          '<label class="inv-filter-label">Date range</label>' +
          '<div class="inv-filter-dates">' +
            '<input type="date" id="inv-filter-from" placeholder="From" value="' + (_invFilters.from || '') + '"' +
              ' onchange="window.invoiceMgr._filterDate(\'from\',this.value)">' +
            '<span>–</span>' +
            '<input type="date" id="inv-filter-to" placeholder="To" value="' + (_invFilters.to || '') + '"' +
              ' onchange="window.invoiceMgr._filterDate(\'to\',this.value)">' +
          '</div>' +
        '</div>' +

        '<div class="inv-filter-group">' +
          '<label class="inv-filter-label">Status</label>' +
          '<div class="inv-filter-chips">' + statusOpts + '</div>' +
        '</div>' +

        '<div class="inv-filter-group">' +
          '<label class="inv-filter-label">Service type</label>' +
          '<div class="inv-filter-chips">' + serviceOpts + '</div>' +
        '</div>' +

        '<div class="inv-filter-group">' +
          '<label class="inv-filter-label">Amount ($)</label>' +
          '<div class="inv-filter-dates">' +
            '<input type="number" min="0" placeholder="Min" style="width:72px" value="' + (_invFilters.minAmount || '') + '"' +
              ' onchange="window.invoiceMgr._filterAmount(\'min\',this.value)">' +
            '<span>–</span>' +
            '<input type="number" min="0" placeholder="Max" style="width:72px" value="' + (_invFilters.maxAmount || '') + '"' +
              ' onchange="window.invoiceMgr._filterAmount(\'max\',this.value)">' +
          '</div>' +
        '</div>' +

        '<div class="inv-filter-group inv-filter-search">' +
          '<input type="search" placeholder="Search name, email, invoice #" class="inv-search-input" ' +
            'value="' + (_invFilters.search || '').replace(/"/g, '&quot;') + '"' +
            ' oninput="window.invoiceMgr._filterSearch(this.value)">' +
        '</div>' +

        '<div class="inv-filter-toggles">' +
          '<label class="inv-toggle-label"><input type="checkbox" ' + (_invFilters.unpaidOnly ? 'checked' : '') +
            ' onchange="window.invoiceMgr._filterToggle(\'unpaidOnly\',this.checked)"> Only unpaid</label>' +
          '<label class="inv-toggle-label"><input type="checkbox" ' + (_invFilters.pastDueOnly ? 'checked' : '') +
            ' onchange="window.invoiceMgr._filterToggle(\'pastDueOnly\',this.checked)"> Only past due</label>' +
          '<button class="inv-reset-btn" onclick="window.invoiceMgr._resetFilters()">Reset</button>' +
        '</div>' +
      '</div>';
  }

  // Filter mutation helpers (called from inline handlers)
  function _filterDate(key, val) { _invFilters[key] = val; _invPage = 0; invLoad(); }
  function _filterStatus(s, on) {
    if (on) { if (_invFilters.status.indexOf(s) < 0) _invFilters.status.push(s); }
    else    { _invFilters.status = _invFilters.status.filter(function (x) { return x !== s; }); }
    _invPage = 0; invLoad();
  }
  function _filterService(s, on) {
    if (on) { if (_invFilters.service.indexOf(s) < 0) _invFilters.service.push(s); }
    else    { _invFilters.service = _invFilters.service.filter(function (x) { return x !== s; }); }
    _invPage = 0; invLoad();
  }
  function _filterAmount(key, val) {
    _invFilters[key === 'min' ? 'minAmount' : 'maxAmount'] = val;
    _invPage = 0; invLoad();
  }
  var _searchTimer = null;
  function _filterSearch(val) {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function () { _invFilters.search = val; _invPage = 0; invLoad(); }, 300);
  }
  function _filterToggle(key, val) { _invFilters[key] = val; _invPage = 0; invLoad(); }
  function _resetFilters() {
    _invFilters = { from: '', to: '', status: [], service: [], minAmount: '', maxAmount: '', search: '', unpaidOnly: false, pastDueOnly: false };
    _invPage = 0;
    invRenderFilters();
    invLoad();
  }

  // ── Load + render table ───────────────────────────────────────────────────
  function invBuildQs() {
    var p = [];
    if (_invFilters.from)        p.push('from='       + encodeURIComponent(_invFilters.from));
    if (_invFilters.to)          p.push('to='         + encodeURIComponent(_invFilters.to));
    if (_invFilters.status.length)  p.push('status='  + encodeURIComponent(_invFilters.status.join(',')));
    if (_invFilters.service.length) p.push('service=' + encodeURIComponent(_invFilters.service.join(',')));
    if (_invFilters.minAmount)   p.push('minAmount='  + encodeURIComponent(_invFilters.minAmount));
    if (_invFilters.maxAmount)   p.push('maxAmount='  + encodeURIComponent(_invFilters.maxAmount));
    if (_invFilters.search)      p.push('search='     + encodeURIComponent(_invFilters.search));
    if (_invFilters.unpaidOnly)  p.push('unpaidOnly=true');
    if (_invFilters.pastDueOnly) p.push('pastDueOnly=true');
    p.push('limit='  + _invPageSize);
    p.push('offset=' + (_invPage * _invPageSize));
    return '/api/invoices/list?' + p.join('&');
  }

  function invLoad() {
    var wrap = document.getElementById('inv-table-wrap');
    if (!wrap) return;
    if (_invLoading) return;
    _invLoading = true;
    wrap.style.opacity = '0.5';

    apiGet(invBuildQs()).then(function (data) {
      _invLoading = false;
      wrap.style.opacity = '';
      if (!data || !data.ok) { wrap.innerHTML = '<div class="inv-table-empty">Error loading invoices.</div>'; return; }
      _invRows  = data.invoices || [];
      _invTotal = data.total    || 0;
      invRenderTable();
      invRenderPagination();
    }).catch(function () {
      _invLoading = false;
      wrap.style.opacity = '';
      wrap.innerHTML = '<div class="inv-table-empty">Error loading invoices.</div>';
    });
  }

  function invRenderTable() {
    var wrap = document.getElementById('inv-table-wrap');
    if (!wrap) return;

    if (!_invRows.length) {
      wrap.innerHTML = '<div class="inv-table-empty">No invoices match the current filters.</div>';
      return;
    }

    var allSelected = _invRows.length > 0 && _invRows.every(function (inv) { return _invSelected[inv.id]; });

    var thead =
      '<thead><tr>' +
        '<th class="inv-col-cb"><input type="checkbox" title="Select all" ' + (allSelected ? 'checked' : '') +
          ' onchange="window.invoiceMgr._selectAll(this.checked)"></th>' +
        '<th>Invoice #</th>' +
        '<th>Customer</th>' +
        '<th>Event</th>' +
        '<th>Issued</th>' +
        '<th>Due</th>' +
        '<th class="inv-col-num">Amount</th>' +
        '<th class="inv-col-num">Paid</th>' +
        '<th class="inv-col-num">Balance</th>' +
        '<th>Status</th>' +
        '<th>Source</th>' +
        '<th class="inv-col-actions"></th>' +
      '</tr></thead>';

    var tbody = '<tbody>' + _invRows.map(function (inv) {
      var rowCls = inv.status === 'past_due' ? ' class="inv-row-pastdue"' : (inv.status === 'void' ? ' class="inv-row-void"' : '');
      var isSelected = !!_invSelected[inv.id];
      return '<tr' + rowCls + '>' +
        '<td class="inv-col-cb"><input type="checkbox" ' + (isSelected ? 'checked' : '') +
          ' onchange="window.invoiceMgr._selectRow(\'' + inv.id + '\',this.checked)"></td>' +
        '<td class="inv-col-num"><span class="inv-inv-number">' + (inv.invoiceNumber || '—') + '</span></td>' +
        '<td>' +
          '<div class="inv-customer-cell">' +
            '<button class="inv-customer-link" onclick="window.invoiceMgr._openCustomer(\'' +
              (inv.customerId || inv.customerEmail || '').replace(/'/g, "\\'") + '\',\'' +
              (inv.threadId || '').replace(/'/g, "\\'") + '\')">' +
              (inv.customerName || inv.customerEmail || '—') +
            '</button>' +
            (inv.customerEmail ? '<span class="inv-customer-email">' + inv.customerEmail + '</span>' : '') +
          '</div>' +
        '</td>' +
        '<td>' + (inv.eventDate  || '—') + '</td>' +
        '<td>' + (inv.issueDate  || '—') + '</td>' +
        '<td>' + (inv.dueDate    || '—') + '</td>' +
        '<td class="inv-col-num">' + fmtDollar2(inv.total     || 0) + '</td>' +
        '<td class="inv-col-num">' + fmtDollar2(inv.amountPaid || 0) + '</td>' +
        '<td class="inv-col-num' + ((inv.balance || 0) > 0 && inv.status !== 'void' ? ' inv-col-balance-due' : '') + '">' +
          fmtDollar2(inv.balance || 0) + '</td>' +
        '<td>' + statusBadge(inv.status) + '</td>' +
        '<td>' + methodSourceIcon(inv.lastPaymentMethod) + '</td>' +
        '<td class="inv-col-actions">' + invRowMenu(inv) + '</td>' +
      '</tr>';
    }).join('') + '</tbody>';

    wrap.innerHTML = '<div class="inv-table-scroll"><table class="inv-table">' + thead + tbody + '</table></div>';
    invUpdateBulkBar();
  }

  function invRowMenu(inv) {
    var items = [];
    if (inv.status !== 'void' && inv.status !== 'paid') {
      items.push('<button class="inv-menu-item" onclick="window.invoiceMgr.openRecordPayment(\'' + inv.id + '\')">Record payment</button>');
    }
    if (inv.status !== 'void') {
      items.push('<button class="inv-menu-item" onclick="window.invoiceMgr._sendReminder(\'' + inv.id + '\')">Send reminder</button>');
    }
    items.push('<a class="inv-menu-item" href="/api/invoices/pdf?id=' + inv.id + '" target="_blank">Download PDF</a>');
    if (inv.status !== 'void') {
      items.push('<button class="inv-menu-item inv-menu-danger" onclick="window.invoiceMgr._voidInvoice(\'' + inv.id + '\')">Void</button>');
    }

    return '<div class="inv-row-menu">' +
      '<button class="inv-row-menu-btn" onclick="window.invoiceMgr._toggleMenu(this)" aria-label="Actions">⋮</button>' +
      '<div class="inv-row-menu-dropdown" style="display:none">' + items.join('') + '</div>' +
      '</div>';
  }

  function _toggleMenu(btn) {
    document.querySelectorAll('.inv-row-menu-dropdown').forEach(function (d) {
      if (d.previousElementSibling !== btn) d.style.display = 'none';
    });
    var dd = btn.nextElementSibling;
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  }

  function invRenderPagination() {
    var el = document.getElementById('inv-pagination');
    if (!el) return;
    var totalPages = Math.max(1, Math.ceil(_invTotal / _invPageSize));
    if (totalPages <= 1 && _invTotal <= _invPageSize) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<div class="inv-pagination-wrap">' +
        '<span class="inv-pagination-info">' +
          (_invPage * _invPageSize + 1) + '–' + Math.min((_invPage + 1) * _invPageSize, _invTotal) +
          ' of ' + _invTotal +
        '</span>' +
        '<div class="inv-pagination-btns">' +
          '<button ' + (_invPage === 0 ? 'disabled' : '') + ' onclick="window.invoiceMgr._prevPage()">← Prev</button>' +
          '<span>' + (_invPage + 1) + ' / ' + totalPages + '</span>' +
          '<button ' + (_invPage >= totalPages - 1 ? 'disabled' : '') + ' onclick="window.invoiceMgr._nextPage()">Next →</button>' +
        '</div>' +
        '<select onchange="window.invoiceMgr._setPageSize(+this.value)">' +
          [50,100,250].map(function (n) {
            return '<option value="' + n + '"' + (n === _invPageSize ? ' selected' : '') + '>' + n + ' per page</option>';
          }).join('') +
        '</select>' +
      '</div>';
  }

  function _prevPage() { if (_invPage > 0) { _invPage--; invLoad(); } }
  function _nextPage() { var tp = Math.ceil(_invTotal / _invPageSize); if (_invPage < tp - 1) { _invPage++; invLoad(); } }
  function _setPageSize(n) { _invPageSize = n; _invPage = 0; invLoad(); }

  // ── Bulk select ───────────────────────────────────────────────────────────
  function _selectAll(on) {
    _invRows.forEach(function (inv) { if (on) _invSelected[inv.id] = true; else delete _invSelected[inv.id]; });
    invRenderTable();
  }
  function _selectRow(id, on) {
    if (on) _invSelected[id] = true; else delete _invSelected[id];
    invUpdateBulkBar();
    var allSelected = _invRows.length && _invRows.every(function (inv) { return _invSelected[inv.id]; });
    var cb = document.querySelector('.inv-col-cb input[type="checkbox"]:first-child');
    if (cb) cb.checked = allSelected;
  }

  function invUpdateBulkBar() {
    var bar = document.getElementById('inv-bulk-bar');
    if (!bar) return;
    var ids = Object.keys(_invSelected);
    if (!ids.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.innerHTML =
      '<div class="inv-bulk-inner">' +
        '<span>' + ids.length + ' selected</span>' +
        '<button class="btn btn-sm btn-primary" onclick="window.invoiceMgr._bulkMarkPaid()">Mark Paid</button>' +
        '<button class="btn btn-sm" onclick="window.invoiceMgr._bulkExport()">Export CSV</button>' +
        '<button class="btn btn-sm inv-btn-danger" onclick="window.invoiceMgr._bulkVoid()">Void</button>' +
        '<button class="btn btn-sm" onclick="window.invoiceMgr._clearSelection()">Clear</button>' +
      '</div>';
  }

  function _clearSelection() { _invSelected = {}; invRenderTable(); }

  function _bulkMarkPaid() {
    var ids = Object.keys(_invSelected);
    if (!ids.length) return;
    if (!confirm('Mark ' + ids.length + ' invoice(s) as paid?')) return;
    Promise.all(ids.map(function (id) {
      return apiPost('/api/invoices/payment', { id: id, amount: 999999, method: 'other', note: 'bulk mark paid' });
    })).then(function () { _invSelected = {}; invLoad(); invLoadSummary(); });
  }

  function _bulkVoid() {
    var ids = Object.keys(_invSelected);
    if (!ids.length) return;
    if (!confirm('Void ' + ids.length + ' invoice(s)? This cannot be undone.')) return;
    Promise.all(ids.map(function (id) {
      return apiPost('/api/invoices/void', { id: id, reason: 'bulk void' });
    })).then(function () { _invSelected = {}; invLoad(); invLoadSummary(); });
  }

  function _bulkExport() {
    var ids = Object.keys(_invSelected);
    var search = ids.map(function (id) { var r = _invRows.find(function (x) { return x.id === id; }); return r ? r.invoiceNumber : ''; }).join(' ');
    window.open('/api/invoices/export?search=' + encodeURIComponent(search));
  }

  // ── Per-row actions ───────────────────────────────────────────────────────
  function _openCustomer(email, threadId) {
    if (window.openCustomerProfile && email) {
      window.openCustomerProfile(email, threadId);
    }
  }

  function _sendReminder(id) {
    apiPost('/api/invoices/remind', { id: id })
      .then(function (d) { alert(d.ok ? ('Reminder sent to ' + d.to) : ('Error: ' + d.error)); });
  }

  function _voidInvoice(id) {
    var reason = prompt('Void reason (optional):');
    if (reason === null) return; // cancelled
    apiPost('/api/invoices/void', { id: id, reason: reason })
      .then(function (d) { if (d.ok) { invLoad(); invLoadSummary(); } else alert('Error: ' + d.error); });
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    var p = [];
    if (_invFilters.from)        p.push('from='       + encodeURIComponent(_invFilters.from));
    if (_invFilters.to)          p.push('to='         + encodeURIComponent(_invFilters.to));
    if (_invFilters.status.length)  p.push('status='  + encodeURIComponent(_invFilters.status.join(',')));
    if (_invFilters.service.length) p.push('service=' + encodeURIComponent(_invFilters.service.join(',')));
    if (_invFilters.search)      p.push('search='     + encodeURIComponent(_invFilters.search));
    if (_invFilters.unpaidOnly)  p.push('unpaidOnly=true');
    if (_invFilters.pastDueOnly) p.push('pastDueOnly=true');
    window.open('/api/invoices/export?' + p.join('&'));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION C — RECORD PAYMENT MODAL
  // ══════════════════════════════════════════════════════════════════════════

  var PAY_METHODS = [
    { key: 'check',   label: 'Check',    icon: '✓',  color: '#1e3a5f' },
    { key: 'cash',    label: 'Cash',     icon: '💵', color: '#1e3a5f' },
    { key: 'venmo',   label: 'Venmo',    icon: 'V',  color: '#3D95CE' },
    { key: 'zelle',   label: 'Zelle',    icon: 'Z',  color: '#6D1ED4' },
    { key: 'cashapp', label: 'Cash App', icon: '$',  color: '#00AA28' },
    { key: 'paypal',  label: 'PayPal',   icon: 'P',  color: '#003087' },
    { key: 'other',   label: 'Other',    icon: '○',  color: '#1e3a5f' },
  ];

  function openRecordPayment(invoiceId) {
    _payInvId  = invoiceId;
    _payStep   = 1;
    _payMethod = null;
    openModal();
    renderPayStep1();
  }

  function renderPayStep1() {
    var inv = _invRows.find(function (r) { return r.id === _payInvId; }) || {};
    var tiles = PAY_METHODS.map(function (m) {
      return '<button class="pay-method-tile" data-method="' + m.key + '" ' +
        'onclick="window.invoiceMgr._selectPayMethod(\'' + m.key + '\')" ' +
        'style="--method-color:' + m.color + '">' +
        '<div class="pay-method-radio"></div>' +
        '<div class="pay-method-icon" style="color:' + m.color + '">' + m.icon + '</div>' +
        '<div class="pay-method-label">' + m.label + '</div>' +
      '</button>';
    }).join('');

    setModalContent(
      '<div class="pay-modal">' +
        '<div class="pay-modal-header">' +
          '<button class="pay-back-btn" onclick="window.invoiceMgr.closeModal()" aria-label="Close">&#8592;</button>' +
          '<span class="pay-modal-title">Record Payment</span>' +
        '</div>' +
        '<div class="pay-section-head">Select payment method</div>' +
        '<div class="pay-section-sub">How did they pay?</div>' +
        '<div class="pay-methods-grid">' + tiles + '</div>' +
        '<div style="padding:20px 24px 24px">' +
          '<button class="pay-next-btn" id="pay-next-btn" onclick="window.invoiceMgr._payNext()" disabled>Next</button>' +
        '</div>' +
      '</div>'
    );
  }

  function _selectPayMethod(key) {
    _payMethod = key;
    document.querySelectorAll('.pay-method-tile').forEach(function (t) {
      t.classList.toggle('selected', t.getAttribute('data-method') === key);
    });
    var btn = document.getElementById('pay-next-btn');
    if (btn) btn.disabled = false;
  }

  function _payNext() {
    if (!_payMethod) return;
    _payStep = 2;
    renderPayStep2();
  }

  function renderPayStep2() {
    var inv   = _invRows.find(function (r) { return r.id === _payInvId; }) || {};
    var mMeta = PAY_METHODS.find(function (m) { return m.key === _payMethod; }) || { label: _payMethod };
    var today = new Date().toISOString().slice(0, 10);
    var suggestedAmt = (inv.balance || 0).toFixed(2);

    setModalContent(
      '<div class="pay-modal">' +
        '<div class="pay-modal-header">' +
          '<button class="pay-back-btn" onclick="window.invoiceMgr._payBack()" aria-label="Back">&#8592;</button>' +
          '<span class="pay-modal-title">Record Payment</span>' +
        '</div>' +
        '<div class="pay-section-head" style="padding:16px 24px 0">' + mMeta.label + '</div>' +
        '<div class="pay-form">' +
          '<label>Amount ($) *<input id="pay-amount" type="number" step="0.01" min="0.01" value="' + suggestedAmt + '" required></label>' +
          '<label>Date *<input id="pay-date" type="date" value="' + today + '" required></label>' +
          '<label>Reference / Memo<input id="pay-ref" type="text" placeholder="Check #, transaction ID, etc."></label>' +
          '<label>Note (optional)<input id="pay-note" type="text" placeholder=""></label>' +
        '</div>' +
        '<div class="pay-error" id="pay-error" style="display:none"></div>' +
        '<div style="padding:0 24px 24px">' +
          '<button class="pay-next-btn" onclick="window.invoiceMgr._paySave()">Save Payment</button>' +
        '</div>' +
      '</div>'
    );
  }

  function _payBack() { _payStep = 1; renderPayStep1(); }

  function _paySave() {
    var amount = parseFloat(document.getElementById('pay-amount').value);
    var date   = document.getElementById('pay-date').value;
    var ref    = (document.getElementById('pay-ref')  || {}).value || '';
    var note   = (document.getElementById('pay-note') || {}).value || '';
    var errEl  = document.getElementById('pay-error');

    if (!(amount > 0))  { if (errEl) { errEl.textContent = 'Enter a valid amount.'; errEl.style.display = ''; } return; }
    if (!date)           { if (errEl) { errEl.textContent = 'Enter a payment date.'; errEl.style.display = ''; } return; }
    if (errEl) errEl.style.display = 'none';

    apiPost('/api/invoices/payment', { id: _payInvId, amount: amount, method: _payMethod, date: date, reference: ref, note: note })
      .then(function (d) {
        if (!d.ok) {
          if (errEl) { errEl.textContent = d.error || 'Error saving payment.'; errEl.style.display = ''; }
          return;
        }
        closeModal();
        invLoad();
        invLoadSummary();
      });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION D — CREATE INVOICE MODAL
  // ══════════════════════════════════════════════════════════════════════════

  function openCreate() {
    var payProv = (window.PAYMENT_PROVIDER || '').toLowerCase();
    if (payProv === 'stripe' || payProv === 'square') {
      openModal();
      setModalContent(
        '<div class="pay-modal">' +
          '<div class="pay-modal-header">' +
            '<button class="pay-back-btn" onclick="window.invoiceMgr.closeModal()">&#8592;</button>' +
            '<span class="pay-modal-title">Create Invoice</span>' +
          '</div>' +
          '<div style="padding:32px 24px;text-align:center">' +
            '<div style="font-size:15px;font-weight:600;margin-bottom:12px">' + (payProv === 'stripe' ? 'Stripe' : 'Square') + ' Integration</div>' +
            '<div style="font-size:13px;color:var(--text2)">Invoice creation via ' + payProv + ' is coming soon.<br>Switch PAYMENT_PROVIDER to <code>manual</code> to use the manual invoice builder.</div>' +
          '</div>' +
        '</div>'
      );
      return;
    }
    // Manual mode
    openModal();
    renderCreateForm();
  }

  function renderCreateForm() {
    var today = new Date().toISOString().slice(0, 10);
    setModalContent(
      '<div class="pay-modal inv-create-modal">' +
        '<div class="pay-modal-header">' +
          '<button class="pay-back-btn" onclick="window.invoiceMgr.closeModal()">&#8592;</button>' +
          '<span class="pay-modal-title">Create Invoice</span>' +
        '</div>' +
        '<div class="pay-form" style="max-height:70vh;overflow-y:auto">' +
          '<label>Customer name *<input id="ci-name" type="text" placeholder="Jane Smith" required></label>' +
          '<label>Customer email *<input id="ci-email" type="email" placeholder="jane@example.com" required></label>' +
          '<label>Phone<input id="ci-phone" type="tel" placeholder="(214) 555-1234"></label>' +
          '<label>Event date<input id="ci-event" type="date"></label>' +
          '<label>Issue date *<input id="ci-issue" type="date" value="' + today + '" required></label>' +
          '<label>Due date<input id="ci-due" type="date"></label>' +
          '<label>Service type' +
            '<select id="ci-service">' +
              ALL_SERVICES.map(function (s) { return '<option value="' + s + '">' + SERVICE_LABEL[s] + '</option>'; }).join('') +
            '</select>' +
          '</label>' +
          '<label>Total amount ($) *<input id="ci-total" type="number" step="0.01" min="0" placeholder="0.00" required></label>' +
          '<label>Notes<textarea id="ci-notes" rows="3" placeholder="Optional notes…"></textarea></label>' +
        '</div>' +
        '<div class="pay-error" id="ci-error" style="display:none"></div>' +
        '<div style="padding:12px 24px 24px;display:flex;gap:10px">' +
          '<button class="pay-next-btn" onclick="window.invoiceMgr._createSave()">Create Invoice</button>' +
          '<button class="btn" onclick="window.invoiceMgr.closeModal()">Cancel</button>' +
        '</div>' +
      '</div>'
    );
  }

  function _createSave() {
    var name  = (document.getElementById('ci-name')    || {}).value || '';
    var email = (document.getElementById('ci-email')   || {}).value || '';
    var phone = (document.getElementById('ci-phone')   || {}).value || '';
    var event = (document.getElementById('ci-event')   || {}).value || null;
    var issue = (document.getElementById('ci-issue')   || {}).value || '';
    var due   = (document.getElementById('ci-due')     || {}).value || null;
    var svc   = (document.getElementById('ci-service') || {}).value || 'pickup';
    var total = parseFloat((document.getElementById('ci-total') || {}).value || '0');
    var notes = (document.getElementById('ci-notes')   || {}).value || '';
    var errEl = document.getElementById('ci-error');

    if (!name)          { if (errEl) { errEl.textContent = 'Customer name is required.';  errEl.style.display = ''; } return; }
    if (!email)         { if (errEl) { errEl.textContent = 'Customer email is required.'; errEl.style.display = ''; } return; }
    if (!(total >= 0))  { if (errEl) { errEl.textContent = 'Enter a valid total.';         errEl.style.display = ''; } return; }
    if (errEl) errEl.style.display = 'none';

    apiPost('/api/invoices/create', {
      customerName: name, customerEmail: email, customerPhone: phone,
      eventDate: event, issueDate: issue, dueDate: due,
      serviceType: svc, total: total, notes: notes,
    }).then(function (d) {
      if (!d.ok) { if (errEl) { errEl.textContent = d.error || 'Error creating invoice.'; errEl.style.display = ''; } return; }
      closeModal();
      invLoad();
      invLoadSummary();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION E — MODAL SHELL
  // ══════════════════════════════════════════════════════════════════════════

  function openModal() {
    var ov = document.getElementById('inv-modal-overlay');
    if (ov) { ov.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
  }

  function closeModal(e) {
    if (e && e.target !== document.getElementById('inv-modal-overlay')) return;
    var ov = document.getElementById('inv-modal-overlay');
    if (ov) { ov.style.display = 'none'; document.body.style.overflow = ''; }
  }

  function setModalContent(html) {
    var c = document.getElementById('inv-modal-content');
    if (c) c.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION F — PAGE INIT
  // ══════════════════════════════════════════════════════════════════════════

  function initPage() {
    _invPage     = 0;
    _invSelected = {};
    invLoadSummary();
    invRenderFilters();
    invLoad();
  }

  // ── App-level init (called once on page load) ─────────────────────────────
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
        spRenderPanel(salesPanel, null);
        spFetchSummary(function (err, data) { if (!err && data) spRenderPanel(salesPanel, data); });
      } else {
        salesPanel.style.display = 'none';
        if (legacyPanel) legacyPanel.style.display = '';
      }
    }

    // Accounting nav
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

  window.invoiceMgr = {
    init:                 init,
    initPage:             initPage,
    openCreate:           openCreate,
    openRecordPayment:    openRecordPayment,
    closeModal:           closeModal,
    exportCSV:            exportCSV,
    _setRange:            _setRange,
    _applyCustom:         _applyCustom,
    _invSetRange:         _invSetRange,
    _invApplyCustomSummary: _invApplyCustomSummary,
    _filterDate:          _filterDate,
    _filterStatus:        _filterStatus,
    _filterService:       _filterService,
    _filterAmount:        _filterAmount,
    _filterSearch:        _filterSearch,
    _filterToggle:        _filterToggle,
    _resetFilters:        _resetFilters,
    _prevPage:            _prevPage,
    _nextPage:            _nextPage,
    _setPageSize:         _setPageSize,
    _selectAll:           _selectAll,
    _selectRow:           _selectRow,
    _clearSelection:      _clearSelection,
    _bulkMarkPaid:        _bulkMarkPaid,
    _bulkVoid:            _bulkVoid,
    _bulkExport:          _bulkExport,
    _openCustomer:        _openCustomer,
    _sendReminder:        _sendReminder,
    _voidInvoice:         _voidInvoice,
    _toggleMenu:          _toggleMenu,
    _selectPayMethod:     _selectPayMethod,
    _payNext:             _payNext,
    _payBack:             _payBack,
    _paySave:             _paySave,
    _createSave:          _createSave,
  };
}());
