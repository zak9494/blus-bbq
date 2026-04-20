/* ===== MODULE: REPEAT CUSTOMER DETECTION (Rule 14)
   File: static/js/repeat-customer.js
   Loaded by: index.html <script src="/static/js/repeat-customer.js">
   Depends on: window.INQ_SECRET, window.openInquiry
   Exposes: window.repeatCustomerInit(inq)
   ===== */
(function() {
  'use strict';

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  var STATUS_LABELS = {
    new: 'New', approved: 'Approved', quote_sent: 'Quoted', booked: 'Booked',
    completed: 'Completed', declined: 'Declined', needs_info: 'Needs Info',
    quote_drafted: 'Draft'
  };

  function fmtDate(d) {
    if (!d) return '';
    try {
      var p = d.split('-');
      return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch(e) { return d; }
  }

  function render(el, matches, inq) {
    var count = matches.length;
    if (count === 0) { el.style.display = 'none'; return; }

    var ordinal = count === 1 ? '2nd' : count === 2 ? '3rd' : (count + 1) + 'th';
    var name = (inq.extracted_fields && inq.extracted_fields.customer_name) || inq.from || 'This customer';

    var rows = matches.map(function(m) {
      var statusLabel = STATUS_LABELS[m.status] || m.status;
      var total = m.quoteTotal ? ' \u00b7 $' + parseFloat(m.quoteTotal).toFixed(2) : '';
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openInquiry(' + JSON.stringify(m.threadId) + ')">' +
        '<span style="font-size:11px;color:var(--text2);flex:1">' + (fmtDate(m.eventDate) || '—') + '</span>' +
        '<span style="font-size:11px;color:var(--amber)">' + statusLabel + total + '</span>' +
        '<span style="font-size:11px;color:var(--text3)">\u2192</span>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
        '<span style="font-size:13px;font-weight:700;color:var(--text)">\ud83d\udd01 ' + ordinal + ' event for ' + escHtml(name.split(' ')[0]) + '</span>' +
        '<span style="font-size:11px;color:var(--text3)">' + count + ' prior event' + (count > 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div>' + rows + '</div>';
    el.style.display = 'block';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.repeatCustomerInit = async function(inq) {
    var el = document.getElementById('inq-repeat-customer');
    if (!el) return;

    var email = (inq.extracted_fields && inq.extracted_fields.customer_email) ||
                (inq.from || '').match(/<(.+)>/) && (inq.from || '').match(/<(.+)>/)[1] ||
                inq.from || '';
    email = email.toLowerCase().trim();

    if (!email || !inq.threadId) { el.style.display = 'none'; return; }

    try {
      var url = '/api/inquiries/by-email?secret=' + encodeURIComponent(getSecret()) +
                '&email=' + encodeURIComponent(email) +
                '&excludeThreadId=' + encodeURIComponent(inq.threadId);
      var r = await fetch(url);
      var d = await r.json();
      render(el, d.matches || [], inq);
    } catch(e) {
      el.style.display = 'none';
    }
  };

})();
