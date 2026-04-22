/* ── Completed Orders View (Group 4) ── */
(function () {
  'use strict';
  var _container = null, _period = 'this_month', _customStart = '', _customEnd = '', _loading = false, _visible = false;
  var PERIODS = [
    { key: 'this_week',  label: 'This Week'   },
    { key: 'last_week',  label: 'Last Week'   },
    { key: 'this_month', label: 'This Month'  },
    { key: 'last_month', label: 'Last Month'  },
    { key: 'ytd',        label: 'YTD'         },
    { key: 'last_year',  label: 'Last Year'   },
    { key: 'custom',     label: 'Custom Range' }
  ];

  function fmt$(n) {
    if (!n && n !== 0) return '—';
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtDate(s) {
    if (!s) return '—';
    var p = s.split('-');
    if (p.length !== 3) return s;
    var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1];
    return mo + ' ' + +p[2] + ', ' + p[0];
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildUrl() {
    var p = 'period=' + encodeURIComponent(_period);
    if (_period === 'custom') {
      if (_customStart) p += '&start=' + encodeURIComponent(_customStart);
      if (_customEnd)   p += '&end='   + encodeURIComponent(_customEnd);
    }
    return '/api/inquiries/completed?' + p;
  }

  function renderChips(panel) {
    var row = panel.querySelector('.co-chips-row');
    if (!row) return;
    row.innerHTML = PERIODS.map(function (p) {
      return '<button class="co-chip' + (p.key === _period ? ' co-chip-active' : '') + '" data-period="' + p.key + '">' + escHtml(p.label) + '</button>';
    }).join('');
    row.querySelectorAll('.co-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _period = btn.getAttribute('data-period');
        var cr = panel.querySelector('.co-custom-range');
        if (cr) cr.style.display = _period === 'custom' ? 'flex' : 'none';
        renderChips(panel);
        if (_period !== 'custom') load(panel);
      });
    });
  }

  function load(panel) {
    if (_loading) return;
    _loading = true;
    var body = panel.querySelector('.co-body');
    if (body) body.innerHTML = '<div class="co-loading">Loading\u2026</div>';
    fetch(buildUrl())
      .then(function (r) { return r.json(); })
      .then(function (data) { _loading = false; data.ok ? renderData(panel, data) : renderError(panel, data.error || 'Unknown error'); })
      .catch(function (e) { _loading = false; renderError(panel, e.message || 'Network error'); });
  }

  function renderData(panel, data) {
    var body = panel.querySelector('.co-body');
    if (!body) return;
    var t = data.totals || {}, orders = data.orders || [], html = '';
    html += '<div class="co-totals">';
    html += '<div class="co-total-card"><div class="co-total-val">' + escHtml(String(t.count || 0)) + '</div><div class="co-total-lbl">Events</div></div>';
    html += '<div class="co-total-card"><div class="co-total-val">' + escHtml(fmt$(t.total_billed)) + '</div><div class="co-total-lbl">Total Billed</div></div>';
    html += '<div class="co-total-card"><div class="co-total-val">' + escHtml(fmt$(t.subtotal)) + '</div><div class="co-total-lbl">Food Subtotal</div></div>';
    html += '<div class="co-total-card"><div class="co-total-val">' + escHtml(fmt$(t.delivery_fees)) + '</div><div class="co-total-lbl">Delivery Fees</div></div>';
    html += '<div class="co-total-card"><div class="co-total-val">' + escHtml(fmt$(t.service_charges)) + '</div><div class="co-total-lbl">Service Charges</div></div>';
    html += '</div>';
    if (!orders.length) {
      html += '<div class="co-empty">No completed orders in this period.</div>';
      body.innerHTML = html;
      return;
    }
    html += '<div class="co-table-wrap"><table class="co-table"><thead><tr>';
    html += '<th class="co-th">Customer</th><th class="co-th">Event Date</th><th class="co-th">Guests</th>';
    html += '<th class="co-th">Food Sub</th><th class="co-th">Delivery</th><th class="co-th">Service</th><th class="co-th">Total</th>';
    html += '</tr></thead><tbody>';
    orders.forEach(function (o) {
      var tid = escHtml(o.threadId || '');
      html += '<tr class="co-row" onclick="openInquiry(\'' + tid + '\')">'
        + '<td class="co-cell">'            + escHtml(o.customer_name || o.customer_email || '—') + '</td>'
        + '<td class="co-cell">'            + escHtml(fmtDate(o.event_date)) + '</td>'
        + '<td class="co-cell co-cell-muted">' + escHtml(o.guest_count ? String(o.guest_count) : '—') + '</td>'
        + '<td class="co-cell">'            + escHtml(fmt$(o.subtotal)) + '</td>'
        + '<td class="co-cell co-cell-muted">' + escHtml(fmt$(o.delivery_fee)) + '</td>'
        + '<td class="co-cell co-cell-muted">' + escHtml(fmt$(o.service_charge)) + '</td>'
        + '<td class="co-cell" style="font-weight:600">' + escHtml(fmt$(o.total_billed)) + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
    body.innerHTML = html;
  }

  function renderError(panel, msg) {
    var body = panel.querySelector('.co-body');
    if (body) body.innerHTML = '<div class="co-error">Error: ' + escHtml(msg) + '</div>';
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.className = 'co-panel';

    var chipsRow = document.createElement('div');
    chipsRow.className = 'co-chips-row';
    panel.appendChild(chipsRow);

    var cr = document.createElement('div');
    cr.className = 'co-custom-range';
    cr.style.display = 'none';
    cr.innerHTML = '<span style="font-size:12px;color:var(--text2)">From</span>'
      + '<input class="co-date-inp" type="date" id="co-start-inp">'
      + '<span style="font-size:12px;color:var(--text2)">To</span>'
      + '<input class="co-date-inp" type="date" id="co-end-inp">'
      + '<button class="co-custom-apply">Apply</button>';
    cr.querySelector('.co-custom-apply').addEventListener('click', function () {
      _customStart = cr.querySelector('#co-start-inp').value;
      _customEnd   = cr.querySelector('#co-end-inp').value;
      load(panel);
    });
    panel.appendChild(cr);

    var body = document.createElement('div');
    body.className = 'co-body';
    body.innerHTML = '<div class="co-loading">Loading\u2026</div>';
    panel.appendChild(body);

    return panel;
  }

  function show(containerEl) {
    _visible = true;
    _container = containerEl;
    _container.innerHTML = '';
    var panel = buildPanel();
    _container.appendChild(panel);
    renderChips(panel);
    load(panel);
  }

  function hide() {
    _visible = false;
    if (_container) _container.innerHTML = '';
  }

  function isVisible() { return _visible; }

  window.completedOrders = { show: show, hide: hide, isVisible: isVisible };
}());
