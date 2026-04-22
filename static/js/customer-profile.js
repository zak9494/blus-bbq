/* ===== MODULE: CUSTOMER PROFILE (Group 9, flag: customer_profile_v2) ===== */
'use strict';

(function () {
  // Current profile email (used for notes save)
  let _currentEmail = '';

  function fmt(num) {
    return '$' + (num || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function badgeClass(status) {
    if (status === 'booked')    return 'badge-booked';
    if (status === 'completed') return 'badge-completed';
    if (status === 'new')       return 'badge-new';
    return 'badge-other';
  }

  function statusLabel(status) {
    const map = { new: 'New', needs_info: 'Needs Info', quote_drafted: 'Drafted',
      quote_approved: 'Approved', quote_sent: 'Sent', booked: 'Booked',
      declined: 'Declined', completed: 'Completed' };
    return map[status] || status;
  }

  function initials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function renderProfile(data) {
    const s = data.stats || {};
    const page = document.getElementById('page-customer');
    if (!page) return;

    page.innerHTML =
      '<div class="topbar" style="padding-left:12px">' +
        '<div class="topbar-left" style="gap:8px">' +
          '<button class="btn" onclick="customerProfileBack()" style="font-size:18px;padding:2px 10px;line-height:1;min-width:36px">←</button>' +
          '<div class="topbar-title">Customer Profile</div>' +
        '</div>' +
      '</div>' +
      '<div class="content" style="overflow-y:auto">' +
        // Header
        '<div class="cp-header">' +
          '<div class="cp-avatar">' + initials(data.name) + '</div>' +
          '<div>' +
            '<div class="cp-name">' + escHtml(data.name || data.email) + '</div>' +
            '<div class="cp-email">' + escHtml(data.email) + '</div>' +
          '</div>' +
        '</div>' +
        // Stat widgets
        '<div class="cp-stats">' +
          '<div class="cp-stat">' +
            '<div class="cp-stat-val">' + (s.totalEvents || 0) + '</div>' +
            '<div class="cp-stat-label">Total Inquiries</div>' +
          '</div>' +
          '<div class="cp-stat">' +
            '<div class="cp-stat-val">' + (s.bookedCount || 0) + '</div>' +
            '<div class="cp-stat-label">Booked / Completed</div>' +
          '</div>' +
          '<div class="cp-stat">' +
            '<div class="cp-stat-val cp-stat-money">' + fmt(s.totalSpend) + '</div>' +
            '<div class="cp-stat-label">Total Spend</div>' +
          '</div>' +
          '<div class="cp-stat">' +
            '<div class="cp-stat-val cp-stat-money">' + (s.avgOrderSize ? fmt(s.avgOrderSize) : '—') + '</div>' +
            '<div class="cp-stat-label">Avg Order</div>' +
          '</div>' +
        '</div>' +
        // Notes
        '<div class="cp-notes">' +
          '<div class="cp-notes-label">Notes</div>' +
          '<textarea id="cp-notes-ta" placeholder="Add notes about this customer…">' +
            escHtml(data.notes || '') +
          '</textarea>' +
          '<button class="btn cp-notes-save" onclick="customerProfileSaveNotes()">Save Notes</button>' +
        '</div>' +
        // Inquiry history
        '<div class="cp-history">' +
          '<div class="cp-history-title">Inquiry History (' + (data.inquiries || []).length + ')</div>' +
          (data.inquiries && data.inquiries.length ?
            data.inquiries.map(function (inq) {
              const total = inq.quote_total ? fmt(parseFloat(inq.quote_total)) : '';
              return '<div class="cp-history-item" onclick="customerProfileOpenInquiry(\'' +
                escAttr(inq.threadId) + '\')">' +
                '<div class="cp-history-date">' + (inq.event_date || '—') + '</div>' +
                '<div class="cp-history-meta">' +
                  '<div class="cp-history-subject">' + escHtml(inq.subject || inq.customer_name || inq.threadId) + '</div>' +
                  '<div class="cp-history-guests">' + (inq.guest_count ? inq.guest_count + ' guests' : '') + '</div>' +
                '</div>' +
                (total ? '<div class="cp-history-total">' + total + '</div>' : '') +
                '<span class="cp-history-badge ' + badgeClass(inq.status) + '">' + statusLabel(inq.status) + '</span>' +
              '</div>';
            }).join('') :
            '<div style="color:var(--text3);font-size:13px;padding:8px 0">No inquiries found.</div>'
          ) +
        '</div>' +
      '</div>';
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(str) {
    return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // Public API
  window.openCustomerProfile = async function (email, name) {
    if (!email) return;
    _currentEmail = (email || '').toLowerCase().trim();

    const secret = typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '';
    const page = document.getElementById('page-customer');
    if (!page) return;

    if (typeof showPage === 'function') showPage('customer');
    page.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3)">Loading…</div>';

    try {
      const url = '/api/customer/profile?secret=' + encodeURIComponent(secret) +
        '&email=' + encodeURIComponent(_currentEmail);
      const r = await fetch(url);
      const d = await r.json();
      if (!d.ok) { page.innerHTML = '<div style="padding:24px;color:var(--red)">Error: ' + escHtml(d.error) + '</div>'; return; }
      renderProfile(d);
    } catch (e) {
      if (page) page.innerHTML = '<div style="padding:24px;color:var(--red)">Failed to load profile.</div>';
    }
  };

  window.customerProfileBack = function () {
    if (typeof showPage === 'function') showPage('inquiries');
  };

  window.customerProfileOpenInquiry = function (threadId) {
    if (typeof showPage === 'function') showPage('inquiries');
    if (typeof openInquiry === 'function') openInquiry(threadId);
  };

  window.customerProfileSaveNotes = async function () {
    const ta = document.getElementById('cp-notes-ta');
    if (!ta || !_currentEmail) return;
    const secret = typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '';
    try {
      const r = await fetch('/api/customer/profile?secret=' + encodeURIComponent(secret), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: _currentEmail, notes: ta.value }),
      });
      const d = await r.json();
      if (typeof showToast === 'function') showToast(d.ok ? 'Notes saved.' : 'Save failed.');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Save failed.');
    }
  };

  // Inject "View Profile" button into inquiry detail when flag is on
  window.customerProfileInit = function (inq) {
    if (!window.flags || !window.flags.isEnabled('customer_profile_v2')) return;
    const ef = (inq && inq.extracted_fields) || {};
    const email = ef.customer_email || (inq && inq.from) || '';
    const name  = ef.customer_name  || (inq && inq.from) || '';
    if (!email) return;

    // Remove old button if any
    const old = document.getElementById('inq-view-profile-btn');
    if (old) old.remove();

    const actions = document.querySelector('#inq-detail-view .topbar-actions');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id        = 'inq-view-profile-btn';
    btn.className = 'btn';
    btn.textContent = 'Profile';
    btn.onclick = function () { window.openCustomerProfile(email, name); };
    actions.insertBefore(btn, actions.firstChild);
  };
})();
