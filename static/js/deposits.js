/* ===== MODULE: DEPOSIT TRACKER (Rule 14)
   File: static/js/deposits.js
   Loaded by: index.html <script src="/static/js/deposits.js">
   Depends on: window.INQ_SECRET (set in index.html)
   Exposes: window.depositsInit(inq)
            window.depositsRefresh(threadId)
   ===== */
(function() {
  'use strict';

  var METHODS = ['Zelle', 'Cash', 'Check', 'Square', 'Venmo', 'PayPal', 'CreditCard', 'ACH', 'Other'];

  /* ── Secret helper ─────────────────────────── */
  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  /* ── Compute quote grand total from inq.quote ── */
  function getQuoteTotal(inq) {
    var q = inq && inq.quote;
    if (!q || !q.food_subtotal) return null;
    var baseTax = q.sales_tax !== undefined
      ? q.sales_tax
      : Math.round(q.food_subtotal * 0.0825 * 100) / 100;
    var tax = q.tax_exempt ? 0 : baseTax;
    return Math.round((q.food_subtotal + (q.service_charge || 0) + tax + (q.delivery_fee || 0)) * 100) / 100;
  }

  /* ── Format currency ───────────────────────── */
  function fmt(n) { return '$' + (n || 0).toFixed(2); }

  /* ── Format date for display ───────────────── */
  function fmtDate(d) {
    if (!d) return '';
    try {
      var parts = d.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch(e) { return d; }
  }

  /* ── Render the section into #inq-deposit-section ── */
  function render(threadId, deposits, quoteTotal) {
    var el = document.getElementById('inq-deposit-section');
    if (!el) return;

    var totalPaid = deposits.reduce(function(s, d) { return s + (d.amount || 0); }, 0);
    totalPaid = Math.round(totalPaid * 100) / 100;

    var balanceDue = quoteTotal !== null
      ? Math.round((quoteTotal - totalPaid) * 100) / 100
      : null;

    /* ── Summary cells ── */
    var summaryHTML =
      '<div class="dep-summary-cell">' +
        '<div class="dep-summary-label">Quote Total</div>' +
        '<div class="dep-summary-value">' + (quoteTotal !== null ? fmt(quoteTotal) : '—') + '</div>' +
      '</div>' +
      '<div class="dep-summary-cell">' +
        '<div class="dep-summary-label">Deposit Paid</div>' +
        '<div class="dep-summary-value ' + (totalPaid > 0 ? 'dep-paid' : 'dep-zeroed') + '">' + fmt(totalPaid) + '</div>' +
      '</div>' +
      '<div class="dep-summary-cell">' +
        '<div class="dep-summary-label">Balance Due</div>' +
        '<div class="dep-summary-value ' + (balanceDue !== null && balanceDue > 0 ? 'dep-due' : balanceDue === 0 ? 'dep-zeroed' : '') + '">' +
          (balanceDue !== null ? fmt(balanceDue) : '—') +
        '</div>' +
      '</div>';

    /* ── Deposit list items ── */
    var listHTML = deposits.length === 0
      ? '<div class="dep-empty">No deposits recorded yet.</div>'
      : deposits.map(function(d) {
          return '<div class="dep-item">' +
            '<span class="dep-item-amount">' + fmt(d.amount) + '</span>' +
            '<span class="dep-item-meta">' +
              '<span class="dep-item-date-method">' + fmtDate(d.date) + (d.method ? ' \u00b7 ' + d.method : '') + '</span>' +
              (d.note ? '<span class="dep-item-note">' + escHtml(d.note) + '</span>' : '') +
            '</span>' +
            '<button class="dep-item-del" onclick="depositsDelete(' + JSON.stringify(threadId) + ',' + JSON.stringify(d.id) + ')" title="Remove deposit">\u00d7</button>' +
          '</div>';
        }).join('');

    /* ── Add form ── */
    var today = new Date().toISOString().slice(0, 10);
    var methodOpts = METHODS.map(function(m) {
      return '<option value="' + m + '">' + m + '</option>';
    }).join('');

    var formHTML =
      '<div id="dep-form-' + threadId + '" class="dep-form">' +
        '<div class="dep-form-row">' +
          '<div>' +
            '<label>Amount ($)</label>' +
            '<input type="number" id="dep-amt-' + threadId + '" min="0.01" step="0.01" placeholder="500.00">' +
          '</div>' +
          '<div>' +
            '<label>Date</label>' +
            '<input type="date" id="dep-date-' + threadId + '" value="' + today + '">' +
          '</div>' +
        '</div>' +
        '<div class="dep-form-row">' +
          '<div>' +
            '<label>Method</label>' +
            '<select id="dep-method-' + threadId + '">' + methodOpts + '</select>' +
          '</div>' +
          '<div>' +
            '<label>Note (optional)</label>' +
            '<input type="text" id="dep-note-' + threadId + '" placeholder="e.g. Half deposit">' +
          '</div>' +
        '</div>' +
        '<div class="dep-form-btns">' +
          '<button class="btn btn-sm" onclick="depositsCloseForm(' + JSON.stringify(threadId) + ')">Cancel</button>' +
          '<button class="btn btn-sm btn-primary" onclick="depositsSave(' + JSON.stringify(threadId) + ')">Record Deposit</button>' +
        '</div>' +
      '</div>';

    el.innerHTML =
      '<div class="inq-section-title" style="margin-bottom:10px">Deposits &amp; Balance</div>' +
      '<div class="dep-section">' +
        '<div class="dep-summary">' + summaryHTML + '</div>' +
        '<div class="dep-list">' + listHTML + '</div>' +
        formHTML +
        '<div class="dep-footer">' +
          '<button class="dep-add-btn" id="dep-add-btn-' + threadId + '" onclick="depositsOpenForm(' + JSON.stringify(threadId) + ')">+ Record Deposit</button>' +
        '</div>' +
      '</div>';

    el.style.display = 'block';
  }

  /* ── Escape HTML ───────────────────────────── */
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Public: init ───────────────────────────── */
  window.depositsInit = async function(inq) {
    var el = document.getElementById('inq-deposit-section');
    if (!el) return;
    var threadId   = inq && inq.threadId;
    var quoteTotal = getQuoteTotal(inq);
    if (!threadId) { el.style.display = 'none'; return; }

    el.innerHTML = '<div class="inq-section-title">Deposits &amp; Balance</div><div style="padding:8px 0;font-size:12px;color:var(--text3)">Loading\u2026</div>';
    el.style.display = 'block';

    try {
      var r = await fetch('/api/deposits/list?secret=' + encodeURIComponent(getSecret()) +
                          '&threadId=' + encodeURIComponent(threadId));
      var d = await r.json();
      render(threadId, d.deposits || [], quoteTotal);
      window._depositsCache = window._depositsCache || {};
      window._depositsCache[threadId] = { deposits: d.deposits || [], quoteTotal: quoteTotal };
    } catch(e) {
      el.innerHTML = '<div style="font-size:12px;color:#f87171;padding:8px 0">Failed to load deposits</div>';
    }
  };

  /* ── Public: refresh ───────────────────────── */
  window.depositsRefresh = async function(threadId) {
    var cache = window._depositsCache && window._depositsCache[threadId];
    var quoteTotal = cache ? cache.quoteTotal : null;
    try {
      var r = await fetch('/api/deposits/list?secret=' + encodeURIComponent(getSecret()) +
                          '&threadId=' + encodeURIComponent(threadId));
      var d = await r.json();
      render(threadId, d.deposits || [], quoteTotal);
    } catch(e) {}
  };

  /* ── Form open/close ───────────────────────── */
  window.depositsOpenForm = function(threadId) {
    var f = document.getElementById('dep-form-' + threadId);
    var b = document.getElementById('dep-add-btn-' + threadId);
    if (f) f.classList.add('dep-form-open');
    if (b) b.style.display = 'none';
  };

  window.depositsCloseForm = function(threadId) {
    var f = document.getElementById('dep-form-' + threadId);
    var b = document.getElementById('dep-add-btn-' + threadId);
    if (f) f.classList.remove('dep-form-open');
    if (b) b.style.display = '';
  };

  /* ── Save a deposit ────────────────────────── */
  window.depositsSave = async function(threadId) {
    var amt    = parseFloat(document.getElementById('dep-amt-'    + threadId).value);
    var date   = document.getElementById('dep-date-'  + threadId).value;
    var method = document.getElementById('dep-method-'+ threadId).value;
    var note   = document.getElementById('dep-note-'  + threadId).value.trim();

    if (!amt || amt <= 0) { alert('Please enter a valid deposit amount.'); return; }

    try {
      var r = await fetch('/api/deposits/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: getSecret(),
          threadId: threadId,
          deposit: { amount: amt, date: date, method: method, note: note },
        }),
      });
      var d = await r.json();
      if (!d.ok) { alert('Save failed: ' + (d.error || 'unknown')); return; }
      var cache = window._depositsCache && window._depositsCache[threadId];
      var quoteTotal = cache ? cache.quoteTotal : null;
      render(threadId, d.deposits || [], quoteTotal);
      if (window._depositsCache) window._depositsCache[threadId] = { deposits: d.deposits || [], quoteTotal: quoteTotal };
    } catch(e) { alert('Error: ' + e.message); }
  };

  /* ── Delete a deposit ─────────────────────── */
  window.depositsDelete = async function(threadId, depositId) {
    if (!confirm('Remove this deposit record?')) return;
    try {
      var r = await fetch('/api/deposits/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: getSecret(),
          threadId: threadId,
          action: 'delete',
          depositId: depositId,
        }),
      });
      var d = await r.json();
      if (!d.ok) { alert('Delete failed: ' + (d.error || 'unknown')); return; }
      var cache = window._depositsCache && window._depositsCache[threadId];
      var quoteTotal = cache ? cache.quoteTotal : null;
      render(threadId, d.deposits || [], quoteTotal);
      if (window._depositsCache) window._depositsCache[threadId] = { deposits: d.deposits || [], quoteTotal: quoteTotal };
    } catch(e) { alert('Error: ' + e.message); }
  };

})();
