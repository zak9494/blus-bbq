/* ===== MODULE: CUSTOMER PROFILE PAGE
   SPA page — shows customer history, timeline, notes, quote actions.
   Exposes: window.customerProfile.show(email), window.customerProfile.init()
   ===== */
(function () {
  'use strict';

  let _currentEmail = null;
  let _notesTimer   = null;
  let _lastNotes    = '';

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function fmtMoney(n) {
    if (!n && n !== 0) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
    });
  }

  function statusBadge(status) {
    const map = {
      new:           ['New', 'var(--text3)', 'var(--surface2)'],
      needs_info:    ['Needs Info', 'var(--amber)', 'var(--amber-bg)'],
      quote_drafted: ['Quote Drafted', 'var(--blue)', '#dbeafe'],
      quote_approved:['Quote Approved', 'var(--green)', '#d1fae5'],
      quote_sent:    ['Quote Sent', 'var(--orange)', '#fff7ed'],
      booked:        ['Booked ✓', 'var(--green)', '#d1fae5'],
      declined:      ['Declined', 'var(--red)', '#fee2e2'],
      archived:      ['Archived', 'var(--text3)', 'var(--surface2)'],
      completed:     ['Completed', 'var(--green)', '#d1fae5'],
    };
    const [label, color, bg] = map[status] || [status, 'var(--text3)', 'var(--surface2)'];
    return `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${bg};color:${color}">${label}</span>`;
  }

  function avatarInitials(name, email) {
    const n = (name || email || '?').trim();
    const parts = n.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }

  async function loadProfile(email) {
    const page = document.getElementById('page-customer');
    if (!page) return;
    const content = page.querySelector('.content');
    if (!content) return;

    content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Loading customer profile…</div>';

    try {
      const r = await fetch('/api/customer/profile?email=' + encodeURIComponent(email) + '&secret=' + encodeURIComponent(secret()));
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Load failed');

      const c = d.customer;
      _lastNotes = d.notes || '';

      const initials  = avatarInitials(c.name, c.email);
      const totalBilled = fmtMoney(c.totalBilled);

      let eventsHtml = '';
      if (!c.events || c.events.length === 0) {
        eventsHtml = '<div class="cp-empty">No past events found for this customer.</div>';
      } else {
        eventsHtml = c.events.map(ev => `
          <div class="cp-event-card" onclick="window.customerProfile.openEvent('${ev.threadId}')">
            <div class="cp-event-top">
              <div>
                <div class="cp-event-date">${fmtDate(ev.eventDate)}</div>
                <div style="font-size:12px;color:var(--text2);margin-top:2px">${ev.subject || '(No subject)'}</div>
              </div>
              ${statusBadge(ev.status)}
            </div>
            <div class="cp-event-meta">
              ${ev.guestCount ? `<span>👥 ${ev.guestCount} guests</span>` : ''}
              ${ev.eventType ? `<span>🎉 ${ev.eventType}</span>` : ''}
              ${ev.serviceType ? `<span>🚗 ${ev.serviceType}</span>` : ''}
              ${ev.quoteTotal ? `<span>💰 ${fmtMoney(ev.quoteTotal)}</span>` : ''}
            </div>
            ${ev.menuItems && ev.menuItems.length ? `<div style="font-size:11px;color:var(--text3);margin-top:6px">${ev.menuItems.slice(0, 5).join(' · ')}</div>` : ''}
            <div class="cp-event-actions">
              <button class="btn btn-sm" onclick="event.stopPropagation();window.customerProfile.openEvent('${ev.threadId}')">View Inquiry</button>
              <button class="btn btn-sm" onclick="event.stopPropagation();window.customerProfile.duplicateQuote('${ev.threadId}')">Duplicate Quote</button>
            </div>
          </div>
        `).join('');
      }

      content.innerHTML = `
        <button class="cp-back-btn" onclick="window.customerProfile.back()">← Back to Pipeline</button>
        <div class="cp-header">
          <div style="display:flex;align-items:center;gap:14px">
            <div class="cp-avatar">${initials}</div>
            <div class="cp-info">
              <div class="cp-name">${c.name || c.email}</div>
              <div class="cp-meta">
                <span>✉ ${c.email}</span>
                ${c.phone ? `<span>📞 ${c.phone}</span>` : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="cp-stats">
          <div class="cp-stat">
            <div class="cp-stat-val">${c.totalEvents}</div>
            <div class="cp-stat-label">Visits</div>
          </div>
          <div class="cp-stat">
            <div class="cp-stat-val">${totalBilled}</div>
            <div class="cp-stat-label">Lifetime Value</div>
          </div>
          <div class="cp-stat">
            <div class="cp-stat-val">${c.events.filter(e => e.status === 'booked' || e.status === 'completed').length}</div>
            <div class="cp-stat-label">Booked</div>
          </div>
          <div class="cp-stat">
            <div class="cp-stat-val">${c.events.length ? fmtDate(c.events[0].storedAt || c.events[0].eventDate) : '—'}</div>
            <div class="cp-stat-label">Last Visit</div>
          </div>
        </div>

        <div class="cp-notes-panel">
          <div class="cp-notes-label">Personal Notes</div>
          <textarea class="cp-notes-textarea" id="cp-notes-input" placeholder="Kids names, allergies, preferences, special requests…">${_lastNotes}</textarea>
          <div class="cp-notes-saving" id="cp-notes-status"></div>
        </div>

        <div class="cp-timeline-hdr">Event History (${c.events.length})</div>
        ${eventsHtml}
      `;

      // Wire up notes autosave
      const textarea = document.getElementById('cp-notes-input');
      if (textarea) {
        textarea.addEventListener('blur', () => saveNotes(email, textarea.value));
        textarea.addEventListener('input', () => {
          clearTimeout(_notesTimer);
          _notesTimer = setTimeout(() => saveNotes(email, textarea.value), 2000);
        });
      }
    } catch (err) {
      content.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">Error loading profile: ${err.message}</div>`;
    }
  }

  async function saveNotes(email, notes) {
    if (notes === _lastNotes) return;
    const statusEl = document.getElementById('cp-notes-status');
    if (statusEl) statusEl.textContent = 'Saving…';
    try {
      const r = await fetch('/api/customer/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, notes, secret: secret() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Save failed');
      _lastNotes = notes;
      if (statusEl) {
        statusEl.textContent = 'Saved';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Save failed: ' + err.message;
    }
  }

  function show(email) {
    _currentEmail = email;
    if (typeof window.showPage === 'function') window.showPage('customer');
    loadProfile(email);
  }

  function back() {
    if (typeof window.showPage === 'function') window.showPage('pipeline');
  }

  function openEvent(threadId) {
    // Navigate to the inquiry — open the inquiry detail modal if available
    if (typeof window.openInquiryDetail === 'function') {
      window.openInquiryDetail(threadId);
    } else {
      // Fallback: navigate to inquiries page and open
      if (typeof window.showPage === 'function') window.showPage('inquiries');
    }
  }

  async function duplicateQuote(threadId) {
    if (!confirm('Duplicate the quote from this event? A new draft will be created with the same menu items.')) return;
    try {
      const r = await fetch('/api/quotes/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret(), threadId }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Duplicate failed');
      if (typeof window.showNotification === 'function') {
        window.showNotification('Quote duplicated — opening new draft…', 'success');
      }
      setTimeout(() => {
        if (typeof window.openInquiryDetail === 'function') window.openInquiryDetail(d.newThreadId);
      }, 800);
    } catch (err) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Duplicate failed: ' + err.message, 'error');
      } else {
        alert('Duplicate failed: ' + err.message);
      }
    }
  }

  function init() { /* no-op — page renders on show() */ }

  window.customerProfile = { show, back, openEvent, duplicateQuote, init };
})();
