/* Invoice Manager — static/js/invoice-manager/index.js
   Exports window.invoiceMgr
   Section A: Sales Summary Panel (pipeline page)
   Section B: Invoice page summary tiles
   Section C: Filter row + table + pagination + bulk actions
   Section D: Record Payment modal (2-step)
   Section E: Create Invoice modal
   Section F: Modal shell + init
*/
(function () {
  'use strict';

  var SECRET = window._appSecret || '';
  var BASE   = '';

  /* ─── helpers ─────────────────────────────────────────── */
  function fmt(n)  { return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function qs(sel) { return document.querySelector(sel); }
  function _toDateStr(d) {
    if (!d) return '';
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dy=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+dy;
  }
  function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

  /* ─── payment method definitions ──────────────────────── */
  var PAY_METHODS = [
    { key: 'check',   label: 'Check',    icon: '✓',  color: '#1e3a5f' },
    { key: 'cash',    label: 'Cash',     icon: '💵', color: '#1e3a5f' },
    { key: 'venmo',   label: 'Venmo',    icon: 'V',  color: '#3D95CE' },
    { key: 'zelle',   label: 'Zelle',    icon: 'Z',  color: '#6D1ED4' },
    { key: 'cashapp', label: 'Cash App', icon: '$',  color: '#00AA28' },
    { key: 'paypal',  label: 'PayPal',   icon: 'P',  color: '#003087' },
    { key: 'other',   label: 'Other',    icon: '○',  color: '#1e3a5f' },
  ];

  /* ─── status badge ─────────────────────────────────────── */
  var STATUS_LABELS = {
    draft: 'Draft', sent: 'Sent', partial: 'Partial',
    paid: 'Paid', past_due: 'Past Due', void: 'Void', refunded: 'Refunded',
  };
  function statusBadge(status) {
    return '<span class="inv-status-badge inv-badge-' + esc(status) + '">' + esc(STATUS_LABELS[status] || status) + '</span>';
  }

  /* ════════════════════════════════════════════════════════
     SECTION A — SALES SUMMARY PANEL (pipeline page)
  ════════════════════════════════════════════════════════ */
  var sp = {
    range: 'month',
    customFrom: '', customTo: '',
    data: null,
  };

  function spFetchSummary() {
    var el = qs('#pipeline-sales-panel');
    if (!el) return;
    var qs2 = 'period=' + sp.range;
    if (sp.range === 'custom' && sp.customFrom) qs2 += '&from=' + sp.customFrom + '&to=' + (sp.customTo || sp.customFrom);
    fetch(BASE + '/api/invoices/summary?' + qs2)
      .then(function (r) { return r.json(); })
      .then(function (d) { sp.data = d; spRenderPanel(d); })
      .catch(function () { spRenderPanel(null); });
  }

  function spRenderPanel(d) {
    var el = qs('#pipeline-sales-panel');
    if (!el) return;
    if (!d || !d.ok) { el.innerHTML = '<p class="sp-error">Unable to load summary.</p>'; return; }
    el.innerHTML =
      '<div class="sp-header">' +
        '<span class="sp-title">Sales Summary</span>' +
        '<div class="sp-range-tabs">' +
          ['month','quarter','ytd'].map(function(p){
            return '<button class="sp-tab' + (sp.range===p?' sp-tab-active':'') + '" onclick="window.invoiceMgr._setRange(\'' + p + '\')">' +
              (p==='month'?'Month':p==='quarter'?'Quarter':'YTD') + '</button>';
          }).join('') +
          '<button class="sp-tab sp-tab-custom' + (sp.range==='custom'?' sp-tab-active':'') + '" onclick="window.invoiceMgr._applyCustom()">Custom</button>' +
        '</div>' +
      '</div>' +
      (sp.range==='custom' ? '<div class="sp-custom-row"><input type="date" id="sp-from" value="' + esc(sp.customFrom) + '"><span>–</span><input type="date" id="sp-to" value="' + esc(sp.customTo) + '"><button onclick="window.invoiceMgr._applyCustom(true)">Go</button></div>' : '') +
      '<div class="sp-tiles">' +
        spTile('Charged',  d.charged,  'sp-tile-charged') +
        spTile('Paid',     d.paid,     'sp-tile-paid') +
        spTile('Unpaid',   d.unpaid,   'sp-tile-unpaid') +
        spTile('Past Due', d.pastDue,  'sp-tile-pastdue') +
      '</div>' +
      '<div class="sp-tiles sp-tiles-row2">' +
        spTile2('Lost $',      fmt(d.lostDollars), '') +
        spTile2('Avg Ticket',  fmt(d.avgTicket),   '') +
        spTile2('# Invoices',  d.invoiceCount,     '') +
      '</div>' +
      '<a class="sp-view-all" href="#" onclick="window.showPage(\'invoices\');return false;">View All Invoices →</a>';
  }

  function spTile(label, val, cls) {
    return '<div class="sp-tile ' + cls + '"><div class="sp-tile-val">' + fmt(val) + '</div><div class="sp-tile-label">' + esc(label) + '</div></div>';
  }
  function spTile2(label, val, cls) {
    return '<div class="sp-tile sp-tile-sm ' + cls + '"><div class="sp-tile-val">' + esc(String(val)) + '</div><div class="sp-tile-label">' + esc(label) + '</div></div>';
  }

  function _setRange(p) {
    sp.range = p;
    spFetchSummary();
  }
  function _applyCustom(go) {
    if (go) {
      sp.customFrom = (qs('#sp-from') || {}).value || '';
      sp.customTo   = (qs('#sp-to')   || {}).value || '';
      sp.range = 'custom';
    } else {
      sp.range = 'custom';
      spRenderPanel(sp.data || { ok: true, charged:0, paid:0, unpaid:0, pastDue:0, lostDollars:0, avgTicket:0, invoiceCount:0 });
    }
    spFetchSummary();
  }

  function spRefresh() { spFetchSummary(); }

  /* ════════════════════════════════════════════════════════
     SECTION B — INVOICE PAGE SUMMARY TILES
  ════════════════════════════════════════════════════════ */
  var inv = {
    range: 'month',
    customFrom: '', customTo: '',
    summary: null,
    /* table state */
    invoices: [],
    total: 0,
    offset: 0,
    limit: 25,
    loading: false,
    /* filters */
    filterFrom: '', filterTo: '',
    filterStatus: [],
    filterService: [],
    filterMin: '', filterMax: '',
    filterSearch: '',
    unpaidOnly: false,
    pastDueOnly: false,
    /* bulk */
    selected: new Set(),
    /* payment modal */
    payInvId: null,
    payMethod: null,
    /* provider */
    provider: (window._paymentProvider || 'manual').toLowerCase(),
  };

  function invLoadSummary() {
    var el = qs('#inv-summary-section');
    if (!el) return;
    var p = 'period=' + inv.range;
    if (inv.range === 'custom' && inv.customFrom) p += '&from=' + inv.customFrom + '&to=' + (inv.customTo || inv.customFrom);
    fetch(BASE + '/api/invoices/summary?' + p)
      .then(function (r) { return r.json(); })
      .then(function (d) { inv.summary = d; invRenderSummary(d); })
      .catch(function () { invRenderSummary(null); });
  }

  function invRenderSummary(d) {
    var el = qs('#inv-summary-section');
    if (!el) return;
    if (!d || !d.ok) { el.innerHTML = '<p class="inv-error">Unable to load summary.</p>'; return; }
    el.innerHTML =
      '<div class="inv-summary-panel">' +
        '<div class="inv-range-tabs">' +
          ['month','quarter','ytd'].map(function(p){
            return '<button class="inv-tab' + (inv.range===p?' inv-tab-active':'') + '" onclick="window.invoiceMgr._invSetRange(\'' + p + '\')">' +
              (p==='month'?'Month':p==='quarter'?'Quarter':'YTD') + '</button>';
          }).join('') +
          '<button class="inv-tab' + (inv.range==='custom'?' inv-tab-active':'') + '" onclick="window.invoiceMgr._invApplyCustom()">Custom</button>' +
        '</div>' +
        (inv.range==='custom' ? '<div class="inv-custom-row"><input type="date" id="inv-sum-from" value="' + esc(inv.customFrom) + '"><span>–</span><input type="date" id="inv-sum-to" value="' + esc(inv.customTo) + '"><button onclick="window.invoiceMgr._invApplyCustom(true)">Go</button></div>' : '') +
        '<div class="inv-stat-row">' +
          invStatTile('Charged',  fmt(d.charged),  'inv-stat-charged') +
          invStatTile('Paid',     fmt(d.paid),     'inv-stat-paid') +
          invStatTile('Unpaid',   fmt(d.unpaid),   'inv-stat-unpaid') +
          invStatTile('Past Due', fmt(d.pastDue),  'inv-stat-pastdue') +
        '</div>' +
        '<div class="inv-stat-row inv-stat-row2">' +
          invStatTile('Lost $',     fmt(d.lostDollars), '') +
          invStatTile('Avg Ticket', fmt(d.avgTicket),   '') +
          invStatTile('# Invoices', String(d.invoiceCount), '') +
        '</div>' +
      '</div>';
  }

  function invStatTile(label, val, cls) {
    return '<div class="inv-stat-tile ' + cls + '"><div class="inv-stat-val">' + esc(val) + '</div><div class="inv-stat-label">' + esc(label) + '</div></div>';
  }

  function _invSetRange(p) {
    inv.range = p;
    invLoadSummary();
  }
  function _invApplyCustom(go) {
    if (go) {
      inv.customFrom = (qs('#inv-sum-from') || {}).value || '';
      inv.customTo   = (qs('#inv-sum-to')   || {}).value || '';
      inv.range = 'custom';
    } else {
      inv.range = 'custom';
      invRenderSummary(inv.summary || { ok:true, charged:0, paid:0, unpaid:0, pastDue:0, lostDollars:0, avgTicket:0, invoiceCount:0 });
    }
    invLoadSummary();
  }

  /* ════════════════════════════════════════════════════════
     SECTION C — FILTER ROW
  ════════════════════════════════════════════════════════ */
  var ALL_STATUSES  = ['draft','sent','partial','paid','past_due','void','refunded'];
  var ALL_SERVICES  = ['pickup','delivery','full_service','catering'];
  var _invDpPicker  = null;

  function invRenderFilters() {
    var el = qs('#inv-filters-row');
    if (!el) return;
    el.innerHTML =
      (window.DatePickerV2 && window.flags && window.flags.isEnabled('date_picker_v2')
        ? '<div class="inv-filter-group"><div id="inv-dp-container"></div></div>'
        : '<div class="inv-filter-group">' +
            '<label>From <input type="date" id="inv-f-from" value="' + esc(inv.filterFrom) + '" onchange="window.invoiceMgr._filterDate()"></label>' +
            '<label>To <input type="date" id="inv-f-to" value="' + esc(inv.filterTo) + '" onchange="window.invoiceMgr._filterDate()"></label>' +
          '</div>') +
      '<div class="inv-filter-group">' +
        '<div class="inv-filter-label">Status</div>' +
        '<div class="inv-multiselect" id="inv-f-status">' +
          ALL_STATUSES.map(function(s){
            return '<label class="inv-ms-chip' + (inv.filterStatus.indexOf(s)>=0?' inv-ms-active':'') + '">' +
              '<input type="checkbox" value="' + s + '" ' + (inv.filterStatus.indexOf(s)>=0?'checked':'') + ' onchange="window.invoiceMgr._filterStatus(this)">' +
              esc(STATUS_LABELS[s] || s) + '</label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="inv-filter-group">' +
        '<div class="inv-filter-label">Service</div>' +
        '<div class="inv-multiselect" id="inv-f-service">' +
          ALL_SERVICES.map(function(s){
            return '<label class="inv-ms-chip' + (inv.filterService.indexOf(s)>=0?' inv-ms-active':'') + '">' +
              '<input type="checkbox" value="' + s + '" ' + (inv.filterService.indexOf(s)>=0?'checked':'') + ' onchange="window.invoiceMgr._filterService(this)">' +
              esc(s) + '</label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="inv-filter-group inv-filter-amount">' +
        '<label>Min $ <input type="number" id="inv-f-min" value="' + esc(inv.filterMin) + '" min="0" step="0.01" onchange="window.invoiceMgr._filterAmount()"></label>' +
        '<label>Max $ <input type="number" id="inv-f-max" value="' + esc(inv.filterMax) + '" min="0" step="0.01" onchange="window.invoiceMgr._filterAmount()"></label>' +
      '</div>' +
      '<div class="inv-filter-group inv-filter-search">' +
        '<input type="search" id="inv-f-search" placeholder="Search name, email, #…" value="' + esc(inv.filterSearch) + '" oninput="window.invoiceMgr._filterSearch(this.value)">' +
      '</div>' +
      '<div class="inv-filter-group inv-filter-toggles">' +
        '<label class="inv-toggle-chip' + (inv.unpaidOnly?' inv-toggle-active':'') + '">' +
          '<input type="checkbox" ' + (inv.unpaidOnly?'checked':'') + ' onchange="window.invoiceMgr._filterToggle(\'unpaid\',this.checked)"> Unpaid only</label>' +
        '<label class="inv-toggle-chip' + (inv.pastDueOnly?' inv-toggle-active':'') + '">' +
          '<input type="checkbox" ' + (inv.pastDueOnly?'checked':'') + ' onchange="window.invoiceMgr._filterToggle(\'pastdue\',this.checked)"> Past due only</label>' +
      '</div>' +
      '<button class="inv-filter-reset" onclick="window.invoiceMgr._resetFilters()">Reset</button>';
    if (window.DatePickerV2 && window.flags && window.flags.isEnabled('date_picker_v2')) {
      if (_invDpPicker) { _invDpPicker.destroy(); _invDpPicker = null; }
      var dpCont = qs('#inv-dp-container');
      if (dpCont) {
        _invDpPicker = window.DatePickerV2.create({
          container: dpCont,
          presets: ['today','yesterday','this_week','last_week','last_7_days','this_month'],
          onChange: function (range) {
            inv.filterFrom = _toDateStr(range.start);
            inv.filterTo   = _toDateStr(range.end);
            inv.offset = 0; invLoad();
          }
        });
        _invDpPicker.mount();
      }
    }
  }

  function _filterDate() {
    inv.filterFrom = (qs('#inv-f-from') || {}).value || '';
    inv.filterTo   = (qs('#inv-f-to')   || {}).value || '';
    inv.offset = 0; invLoad();
  }
  function _filterStatus(cb) {
    var v = cb.value;
    var i = inv.filterStatus.indexOf(v);
    if (cb.checked && i < 0) inv.filterStatus.push(v);
    else if (!cb.checked && i >= 0) inv.filterStatus.splice(i, 1);
    inv.offset = 0; invLoad(); invRenderFilters();
  }
  function _filterService(cb) {
    var v = cb.value;
    var i = inv.filterService.indexOf(v);
    if (cb.checked && i < 0) inv.filterService.push(v);
    else if (!cb.checked && i >= 0) inv.filterService.splice(i, 1);
    inv.offset = 0; invLoad(); invRenderFilters();
  }
  function _filterAmount() {
    inv.filterMin = (qs('#inv-f-min') || {}).value || '';
    inv.filterMax = (qs('#inv-f-max') || {}).value || '';
    inv.offset = 0; invLoad();
  }
  function _filterSearch(v) {
    inv.filterSearch = v;
    clearTimeout(inv._searchTimer);
    inv._searchTimer = setTimeout(function () { inv.offset = 0; invLoad(); }, 300);
  }
  function _filterToggle(type, val) {
    if (type === 'unpaid')  { inv.unpaidOnly  = val; inv.pastDueOnly = false; }
    if (type === 'pastdue') { inv.pastDueOnly = val; inv.unpaidOnly  = false; }
    inv.offset = 0; invLoad(); invRenderFilters();
  }
  function _resetFilters() {
    if (_invDpPicker) { _invDpPicker.destroy(); _invDpPicker = null; }
    inv.filterFrom = ''; inv.filterTo = '';
    inv.filterStatus = []; inv.filterService = [];
    inv.filterMin = ''; inv.filterMax = '';
    inv.filterSearch = '';
    inv.unpaidOnly = false; inv.pastDueOnly = false;
    inv.offset = 0; invRenderFilters(); invLoad();
  }

  /* ════════════════════════════════════════════════════════
     TABLE
  ════════════════════════════════════════════════════════ */
  function invBuildQs() {
    var p = [];
    p.push('limit=' + inv.limit);
    p.push('offset=' + inv.offset);
    if (inv.filterFrom)                  p.push('from='         + encodeURIComponent(inv.filterFrom));
    if (inv.filterTo)                    p.push('to='           + encodeURIComponent(inv.filterTo));
    if (inv.filterStatus.length)         p.push('status='       + encodeURIComponent(inv.filterStatus.join(',')));
    if (inv.filterService.length)        p.push('service='      + encodeURIComponent(inv.filterService.join(',')));
    if (inv.filterMin)                   p.push('minAmount='    + encodeURIComponent(inv.filterMin));
    if (inv.filterMax)                   p.push('maxAmount='    + encodeURIComponent(inv.filterMax));
    if (inv.filterSearch)                p.push('search='       + encodeURIComponent(inv.filterSearch));
    if (inv.unpaidOnly)                  p.push('unpaidOnly=true');
    if (inv.pastDueOnly)                 p.push('pastDueOnly=true');
    return p.join('&');
  }

  function invLoad() {
    var wrap = qs('#inv-table-wrap');
    if (!wrap) return;
    if (inv.loading) return;
    inv.loading = true;
    wrap.innerHTML = '<div class="inv-loading-bar"></div>';

    fetch(BASE + '/api/invoices/list?' + invBuildQs())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        inv.loading = false;
        if (!d || !d.ok) { wrap.innerHTML = '<p class="inv-error">Failed to load invoices.</p>'; return; }
        inv.invoices = d.invoices || [];
        inv.total    = d.total    || 0;
        invRenderTable();
        invRenderPagination();
      })
      .catch(function () {
        inv.loading = false;
        var wrap2 = qs('#inv-table-wrap');
        if (wrap2) wrap2.innerHTML = '<p class="inv-error">Network error loading invoices.</p>';
      });
  }

  function invRenderTable() {
    var wrap = qs('#inv-table-wrap');
    if (!wrap) return;
    if (!inv.invoices.length) {
      wrap.innerHTML = '<p class="inv-empty">No invoices found.</p>';
      return;
    }
    var allSelected = inv.invoices.length > 0 && inv.invoices.every(function (i) { return inv.selected.has(i.id); });
    var html = '<table class="inv-table"><thead><tr>' +
      '<th><input type="checkbox" id="inv-select-all" ' + (allSelected?'checked':'') + ' onchange="window.invoiceMgr._selectAll(this.checked)"></th>' +
      '<th>Invoice #</th>' +
      '<th>Customer</th>' +
      '<th>Event Date</th>' +
      '<th>Issue Date</th>' +
      '<th>Due Date</th>' +
      '<th>Amount</th>' +
      '<th>Paid</th>' +
      '<th>Balance</th>' +
      '<th>Status</th>' +
      '<th>Source</th>' +
      '<th></th>' +
    '</tr></thead><tbody>';

    inv.invoices.forEach(function (row) {
      var sel = inv.selected.has(row.id);
      html += '<tr class="inv-row' + (sel?' inv-row-selected':'') + '" data-id="' + esc(row.id) + '">' +
        '<td><input type="checkbox" class="inv-row-cb" value="' + esc(row.id) + '" ' + (sel?'checked':'') + ' onchange="window.invoiceMgr._selectRow(\'' + esc(row.id) + '\',this.checked)"></td>' +
        '<td class="inv-num">' + esc(row.invoiceNumber || row.id) + '</td>' +
        '<td><a href="#" class="inv-customer-link" onclick="window.showCustomer&&window.showCustomer(' + JSON.stringify(esc(row.customerEmail)) + ');return false;">' + esc(row.customerName || row.customerEmail || '—') + '</a></td>' +
        '<td>' + esc(row.eventDate || '—') + '</td>' +
        '<td>' + esc(row.issueDate || '—') + '</td>' +
        '<td>' + esc(row.dueDate   || '—') + '</td>' +
        '<td>' + fmt(row.total)    + '</td>' +
        '<td>' + fmt(row.amountPaid) + '</td>' +
        '<td>' + fmt(row.balance)  + '</td>' +
        '<td>' + statusBadge(row.status) + '</td>' +
        '<td>' + esc(row.source || 'manual') + '</td>' +
        '<td class="inv-actions-cell"><button class="inv-row-menu-btn" onclick="window.invoiceMgr._toggleMenu(\'' + esc(row.id) + '\',this)" aria-label="Actions">⋯</button><div class="inv-row-menu" id="inv-menu-' + esc(row.id) + '" hidden>' +
          (row.status !== 'void' && row.status !== 'paid' ? '<button onclick="window.invoiceMgr.openRecordPayment(\'' + esc(row.id) + '\')">Record Payment</button>' : '') +
          '<a href="/api/invoices/pdf?id=' + esc(row.id) + '" target="_blank" class="inv-menu-link">Download PDF</a>' +
          (row.status !== 'void' ? '<button onclick="window.invoiceMgr._voidOne(\'' + esc(row.id) + '\')">Void</button>' : '') +
          (row.status !== 'void' && row.customerEmail ? '<button onclick="window.invoiceMgr._sendReminder(\'' + esc(row.id) + '\')">Send Reminder</button>' : '') +
        '</div></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
    invUpdateBulkBar();
  }

  function _toggleMenu(id, btn) {
    qsa('.inv-row-menu').forEach(function (m) {
      if (m.id !== 'inv-menu-' + id) m.hidden = true;
    });
    var menu = qs('#inv-menu-' + id);
    if (menu) menu.hidden = !menu.hidden;
    var close = function (e) {
      if (!btn.contains(e.target) && menu && !menu.contains(e.target)) {
        menu.hidden = true;
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }

  function _voidOne(id) {
    if (!confirm('Void this invoice? This cannot be undone.')) return;
    fetch(BASE + '/api/invoices/void', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ secret: SECRET, id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) invLoad(); else alert('Error: ' + (d.error || 'unknown')); });
  }

  function _sendReminder(id) {
    fetch(BASE + '/api/invoices/remind', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ secret: SECRET, id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { alert(d.ok ? 'Reminder sent!' : 'Error: ' + (d.error || 'unknown')); });
  }

  /* ── Pagination ─── */
  function invRenderPagination() {
    var el = qs('#inv-pagination');
    if (!el) return;
    var totalPages = Math.ceil(inv.total / inv.limit) || 1;
    var curPage    = Math.floor(inv.offset / inv.limit) + 1;
    el.innerHTML =
      '<div class="inv-pagination-wrap">' +
        '<span class="inv-pag-info">' + (inv.offset + 1) + '–' + Math.min(inv.offset + inv.invoices.length, inv.total) + ' of ' + inv.total + '</span>' +
        '<button class="inv-pag-btn" onclick="window.invoiceMgr._prevPage()" ' + (curPage <= 1 ? 'disabled' : '') + '>‹ Prev</button>' +
        '<span class="inv-pag-cur">Page ' + curPage + ' / ' + totalPages + '</span>' +
        '<button class="inv-pag-btn" onclick="window.invoiceMgr._nextPage()" ' + (curPage >= totalPages ? 'disabled' : '') + '>Next ›</button>' +
        '<select class="inv-page-size" onchange="window.invoiceMgr._setPageSize(this.value)">' +
          [10,25,50,100].map(function(n){return '<option value="'+n+'"'+(inv.limit===n?' selected':'')+'>'+n+' / page</option>';}).join('') +
        '</select>' +
      '</div>';
  }

  function _prevPage() { if (inv.offset > 0) { inv.offset = Math.max(0, inv.offset - inv.limit); invLoad(); } }
  function _nextPage() { if (inv.offset + inv.limit < inv.total) { inv.offset += inv.limit; invLoad(); } }
  function _setPageSize(n) { inv.limit = parseInt(n, 10); inv.offset = 0; invLoad(); }

  /* ── Bulk selection ─── */
  function _selectAll(checked) {
    inv.invoices.forEach(function (i) { checked ? inv.selected.add(i.id) : inv.selected.delete(i.id); });
    invRenderTable();
  }
  function _selectRow(id, checked) {
    checked ? inv.selected.add(id) : inv.selected.delete(id);
    invUpdateBulkBar();
  }
  function invUpdateBulkBar() {
    var bar = qs('#inv-bulk-bar');
    if (!bar) return;
    var n = inv.selected.size;
    if (n === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML =
      '<span class="inv-bulk-count">' + n + ' selected</span>' +
      '<button onclick="window.invoiceMgr._bulkMarkPaid()">Mark Paid</button>' +
      '<button onclick="window.invoiceMgr._bulkVoid()">Void</button>' +
      '<button onclick="window.invoiceMgr._bulkExport()">Export CSV</button>' +
      '<button class="inv-bulk-clear" onclick="window.invoiceMgr._clearSelection()">✕ Clear</button>';
  }

  function _clearSelection() { inv.selected.clear(); invRenderTable(); }

  function _bulkMarkPaid() {
    var ids = Array.from(inv.selected);
    if (!ids.length) return;
    if (!confirm('Mark ' + ids.length + ' invoices as paid?')) return;
    var promises = ids.map(function (id) {
      return fetch(BASE + '/api/invoices/update', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ secret: SECRET, id: id, status: 'paid' }) }).then(function(r){return r.json();});
    });
    Promise.all(promises).then(function () { inv.selected.clear(); invLoad(); invLoadSummary(); });
  }

  function _bulkVoid() {
    var ids = Array.from(inv.selected);
    if (!ids.length) return;
    if (!confirm('Void ' + ids.length + ' invoices? This cannot be undone.')) return;
    var promises = ids.map(function (id) {
      return fetch(BASE + '/api/invoices/void', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ secret: SECRET, id: id }) }).then(function(r){return r.json();});
    });
    Promise.all(promises).then(function () { inv.selected.clear(); invLoad(); invLoadSummary(); });
  }

  function _bulkExport() {
    var ids = Array.from(inv.selected);
    if (!ids.length) return;
    exportCSV();
  }

  function exportCSV() {
    var qs2 = invBuildQs().replace(/limit=\d+/, 'limit=250').replace(/offset=\d+/, 'offset=0');
    window.open(BASE + '/api/invoices/export?' + qs2, '_blank');
  }

  /* ════════════════════════════════════════════════════════
     SECTION D — RECORD PAYMENT MODAL
  ════════════════════════════════════════════════════════ */
  function openRecordPayment(id) {
    inv.payInvId = id;
    inv.payMethod = null;
    renderPayStep1();
    openModal();
    qsa('.inv-row-menu').forEach(function (m) { m.hidden = true; });
  }

  function renderPayStep1() {
    setModalContent(
      '<div class="pay-modal">' +
        '<h3 class="pay-modal-title">Record Payment</h3>' +
        '<p class="pay-modal-sub">Select payment method</p>' +
        '<div class="pay-method-grid">' +
          PAY_METHODS.map(function (m) {
            return '<button class="pay-method-tile' + (inv.payMethod === m.key ? ' pay-method-selected' : '') + '" ' +
              'style="--method-color:' + m.color + '" ' +
              'onclick="window.invoiceMgr._selectPayMethod(\'' + m.key + '\')">' +
              '<span class="pay-method-icon">' + esc(m.icon) + '</span>' +
              '<span class="pay-method-label">' + esc(m.label) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<button class="pay-next-btn" id="pay-next-btn" ' + (!inv.payMethod ? 'disabled' : '') + ' onclick="window.invoiceMgr._payNext()">Next →</button>' +
        '<button class="pay-cancel-btn" onclick="window.invoiceMgr.closeModal()">Cancel</button>' +
      '</div>'
    );
  }

  function _selectPayMethod(key) {
    inv.payMethod = key;
    renderPayStep1();
  }

  function _payNext() {
    if (!inv.payMethod) return;
    renderPayStep2();
  }

  function renderPayStep2() {
    var today = new Date().toISOString().slice(0, 10);
    setModalContent(
      '<div class="pay-modal">' +
        '<h3 class="pay-modal-title">Record Payment</h3>' +
        '<p class="pay-modal-sub">Details — <button class="pay-back-link" onclick="window.invoiceMgr.renderPayStep1()">← Change method</button></p>' +
        '<form class="pay-form" onsubmit="window.invoiceMgr._paySave(event)">' +
          '<label class="pay-field">Amount *<input type="number" id="pay-amount" min="0.01" step="0.01" required placeholder="0.00"></label>' +
          '<label class="pay-field">Date<input type="date" id="pay-date" value="' + today + '"></label>' +
          '<label class="pay-field">Reference / Check #<input type="text" id="pay-ref" placeholder="Optional"></label>' +
          '<label class="pay-field">Note<input type="text" id="pay-note" placeholder="Optional"></label>' +
          '<div class="pay-form-actions">' +
            '<button type="submit" class="pay-save-btn">Save Payment</button>' +
            '<button type="button" class="pay-cancel-btn" onclick="window.invoiceMgr.closeModal()">Cancel</button>' +
          '</div>' +
        '</form>' +
      '</div>'
    );
  }

  function _paySave(e) {
    if (e) e.preventDefault();
    var amount = parseFloat((qs('#pay-amount') || {}).value || '0');
    if (!(amount > 0)) { alert('Enter a valid amount.'); return; }
    var date      = (qs('#pay-date') || {}).value || '';
    var reference = (qs('#pay-ref')  || {}).value || '';
    var note      = (qs('#pay-note') || {}).value || '';

    fetch(BASE + '/api/invoices/payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET, id: inv.payInvId, amount: amount, method: inv.payMethod, date: date, reference: reference, note: note }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { closeModal(); invLoad(); invLoadSummary(); }
        else alert('Error: ' + (d.error || 'unknown'));
      });
  }

  /* ════════════════════════════════════════════════════════
     SECTION E — CREATE INVOICE MODAL
  ════════════════════════════════════════════════════════ */
  function openCreate() {
    if (inv.provider === 'stripe' || inv.provider === 'square') {
      openModal();
      setModalContent(
        '<div class="inv-modal-inner">' +
          '<h3>Invoice Manager</h3>' +
          '<p>Integrated payment processing via <strong>' + esc(inv.provider.charAt(0).toUpperCase() + inv.provider.slice(1)) + '</strong> is coming soon.</p>' +
          '<p>Manual invoicing is available — set <code>PAYMENT_PROVIDER=manual</code> to enable.</p>' +
          '<button onclick="window.invoiceMgr.closeModal()">Close</button>' +
        '</div>'
      );
      return;
    }
    renderCreateForm();
    openModal();
  }

  function renderCreateForm() {
    var today = new Date().toISOString().slice(0, 10);
    setModalContent(
      '<div class="inv-modal-inner">' +
        '<h3 class="inv-modal-title">New Invoice</h3>' +
        '<form class="inv-create-form" onsubmit="window.invoiceMgr._createSave(event)">' +
          '<div class="inv-form-row">' +
            '<label class="inv-form-field">Customer Name *<input type="text" id="ci-name" required placeholder="Jane Smith"></label>' +
            '<label class="inv-form-field">Email<input type="email" id="ci-email" placeholder="jane@example.com"></label>' +
          '</div>' +
          '<div class="inv-form-row">' +
            '<label class="inv-form-field">Phone<input type="tel" id="ci-phone" placeholder="(555) 000-0000"></label>' +
            '<label class="inv-form-field">Service Type<select id="ci-service">' +
              ALL_SERVICES.map(function(s){return '<option value="'+s+'">'+s+'</option>';}).join('') +
            '</select></label>' +
          '</div>' +
          '<div class="inv-form-row">' +
            '<label class="inv-form-field">Event Date<input type="date" id="ci-event"></label>' +
            '<label class="inv-form-field">Due Date<input type="date" id="ci-due"></label>' +
          '</div>' +
          '<div class="inv-form-row">' +
            '<label class="inv-form-field">Total $<input type="number" id="ci-total" min="0" step="0.01" required placeholder="0.00"></label>' +
            '<label class="inv-form-field">Issue Date<input type="date" id="ci-issue" value="' + today + '"></label>' +
          '</div>' +
          '<label class="inv-form-field inv-form-notes">Notes<textarea id="ci-notes" rows="3" placeholder="Optional…"></textarea></label>' +
          '<div class="inv-form-actions">' +
            '<button type="submit" class="inv-create-save-btn">Create Invoice</button>' +
            '<button type="button" onclick="window.invoiceMgr.closeModal()">Cancel</button>' +
          '</div>' +
        '</form>' +
      '</div>'
    );
  }

  function _createSave(e) {
    if (e) e.preventDefault();
    var total    = parseFloat((qs('#ci-total') || {}).value || '0');
    var name     = (qs('#ci-name')    || {}).value || '';
    if (!name) { alert('Customer name is required.'); return; }
    if (!(total >= 0)) { alert('Enter a valid total.'); return; }

    var payload = {
      secret:        SECRET,
      customerName:  name,
      customerEmail: (qs('#ci-email')   || {}).value || '',
      customerPhone: (qs('#ci-phone')   || {}).value || '',
      serviceType:   (qs('#ci-service') || {}).value || 'pickup',
      eventDate:     (qs('#ci-event')   || {}).value || null,
      dueDate:       (qs('#ci-due')     || {}).value || null,
      issueDate:     (qs('#ci-issue')   || {}).value || null,
      total:         total,
      subtotal:      total,
      notes:         (qs('#ci-notes')   || {}).value || '',
    };

    fetch(BASE + '/api/invoices/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { closeModal(); invLoad(); invLoadSummary(); }
        else alert('Error: ' + (d.error || 'unknown'));
      });
  }

  /* ════════════════════════════════════════════════════════
     SECTION F — MODAL SHELL
  ════════════════════════════════════════════════════════ */
  function openModal() {
    var overlay = qs('#inv-modal-overlay');
    if (overlay) overlay.hidden = false;
  }
  function closeModal() {
    var overlay = qs('#inv-modal-overlay');
    if (overlay) overlay.hidden = true;
    var content = qs('#inv-modal-content');
    if (content) content.innerHTML = '';
  }
  function setModalContent(html) {
    var content = qs('#inv-modal-content');
    if (content) content.innerHTML = html;
  }

  /* ════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════ */
  function initPage() {
    invLoadSummary();
    invRenderFilters();
    invLoad();
  }

  function init() {
    SECRET = window._appSecret || window.INQ_SECRET || '';
    inv.provider = (window._paymentProvider || 'manual').toLowerCase();
    spFetchSummary();
  }

  /* ── public API ── */
  window.invoiceMgr = {
    init: init,
    initPage: initPage,
    spRefresh: spRefresh,
    _setRange: _setRange,
    _applyCustom: _applyCustom,
    _invSetRange: _invSetRange,
    _invApplyCustom: _invApplyCustom,
    _filterDate: _filterDate,
    _filterStatus: _filterStatus,
    _filterService: _filterService,
    _filterAmount: _filterAmount,
    _filterSearch: _filterSearch,
    _filterToggle: _filterToggle,
    _resetFilters: _resetFilters,
    _toggleMenu: _toggleMenu,
    _selectAll: _selectAll,
    _selectRow: _selectRow,
    invUpdateBulkBar: invUpdateBulkBar,
    _clearSelection: _clearSelection,
    _bulkMarkPaid: _bulkMarkPaid,
    _bulkVoid: _bulkVoid,
    _bulkExport: _bulkExport,
    exportCSV: exportCSV,
    _prevPage: _prevPage,
    _nextPage: _nextPage,
    _setPageSize: _setPageSize,
    openRecordPayment: openRecordPayment,
    renderPayStep1: renderPayStep1,
    _selectPayMethod: _selectPayMethod,
    _payNext: _payNext,
    renderPayStep2: renderPayStep2,
    _paySave: _paySave,
    openCreate: openCreate,
    renderCreateForm: renderCreateForm,
    _createSave: _createSave,
    openModal: openModal,
    closeModal: closeModal,
    setModalContent: setModalContent,
    _voidOne: _voidOne,
    _sendReminder: _sendReminder,
  };
})();
