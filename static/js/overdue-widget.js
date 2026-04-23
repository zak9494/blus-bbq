/* ===== MODULE: OVERDUE WIDGET
   Renders the "What's Overdue" panel at the top of the pipeline dashboard.
   Only renders if the overdue_widget feature flag is ON.
   Exposes: window.overdueWidget.init(), window.overdueWidget.refresh()
   ===== */
(function () {
  'use strict';

  let _loaded = false;

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  }

  function fmtMoney(n) {
    if (!n) return '';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function openInquiry(threadId) {
    if (typeof window.openInquiryDetail === 'function') {
      window.openInquiryDetail(threadId);
    }
  }

  function openCustomer(email) {
    if (email && typeof window.customerProfile !== 'undefined') {
      window.customerProfile.show(email);
    }
  }

  function toggleCollapse() {
    const body = document.getElementById('ow-body');
    const toggle = document.getElementById('ow-toggle-icon');
    if (!body) return;
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    if (toggle) toggle.textContent = collapsed ? '▲' : '▼';
  }

  function renderUnanswered(items) {
    if (!items.length) return '<div class="ow-empty">All quotes answered — nothing overdue.</div>';
    return items.map(q => `
      <div class="ow-row" onclick="(function(){
        if('${q.threadId}')window.overdueWidget._openInquiry('${q.threadId}');
        else if('${q.customerEmail}')window.overdueWidget._openCustomer('${q.customerEmail}');
      })()">
        <div class="ow-row-left">
          <div class="ow-row-name">${q.name}</div>
          <div class="ow-row-meta">${q.eventDate ? 'Event: ' + fmtDate(q.eventDate) : ''}${q.quoteTotal ? ' · ' + fmtMoney(q.quoteTotal) : ''}</div>
        </div>
        <div class="ow-chip">${q.daysSinceSent}d no reply</div>
      </div>`).join('');
  }

  function renderDepositsDue(items) {
    if (!items.length) return '<div class="ow-empty">No overdue deposits.</div>';
    return items.map(d => `
      <div class="ow-row" onclick="window.overdueWidget._openInquiry('${d.threadId}')">
        <div class="ow-row-left">
          <div class="ow-row-name">${d.name}</div>
          <div class="ow-row-meta">${d.depositLabel}${d.depositAmount ? ' · ' + fmtMoney(d.depositAmount) : ''} · ${d.daysOverdue}d overdue</div>
        </div>
        <div class="ow-chip red">Past Due</div>
      </div>`).join('');
  }

  function renderHeadcount(items) {
    if (!items.length) return '<div class="ow-empty">All upcoming events have a headcount.</div>';
    return items.map(e => `
      <div class="ow-row" onclick="window.overdueWidget._openInquiry('${e.threadId}')">
        <div class="ow-row-left">
          <div class="ow-row-name">${e.name}</div>
          <div class="ow-row-meta">Event in ${e.daysUntil}d · ${fmtDate(e.eventDate)}${e.guestCount ? ' · ~' + e.guestCount + ' guests' : ''}</div>
        </div>
        <div class="ow-chip red">No Final Count</div>
      </div>`).join('');
  }

  async function render() {
    const container = document.getElementById('overdue-widget-container');
    if (!container) return;

    // Check flag
    let flagOn = false;
    try {
      const fr = await fetch('/api/flags');
      const fd = await fr.json();
      const flag = (fd.flags || []).find(f => f.name === 'overdue_widget');
      flagOn = flag && flag.enabled;
    } catch { /* flag check failed — hide */ }

    if (!flagOn) { container.style.display = 'none'; return; }

    container.style.display = '';
    container.innerHTML = '<div class="ow-wrap"><div class="ow-header"><div class="ow-title">What\'s Overdue <div class="ow-badge" id="ow-badge">…</div></div><div class="ow-toggle" id="ow-toggle-icon" onclick="window.overdueWidget.toggle()">▲</div></div><div class="ow-body" id="ow-body"><div style="padding:12px;color:var(--text3);font-size:12px">Loading…</div></div></div>';

    try {
      const r = await fetch('/api/pipeline/overdue?secret=' + encodeURIComponent(secret()));
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Load failed');

      const badge = document.getElementById('ow-badge');
      if (badge) badge.textContent = d.total || 0;

      const body = document.getElementById('ow-body');
      if (!body) return;

      if (d.total === 0) {
        body.innerHTML = '<div style="padding:12px 0;font-size:12px;color:var(--text3);font-style:italic">All clear — nothing overdue! 🎉</div>';
      } else {
        let html = '';
        if (d.unanswered_quotes && d.unanswered_quotes.length) {
          html += `<div class="ow-section-hdr">Unanswered Quotes (${d.unanswered_quotes.length})</div>${renderUnanswered(d.unanswered_quotes)}`;
        }
        if (d.deposits_due && d.deposits_due.length) {
          html += `<div class="ow-section-hdr">Deposits Due (${d.deposits_due.length})</div>${renderDepositsDue(d.deposits_due)}`;
        }
        if (d.missing_headcount && d.missing_headcount.length) {
          html += `<div class="ow-section-hdr">Missing Headcount (${d.missing_headcount.length})</div>${renderHeadcount(d.missing_headcount)}`;
        }
        body.innerHTML = html;
      }
      _loaded = true;
    } catch (err) {
      const body = document.getElementById('ow-body');
      if (body) body.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--red)">Failed to load overdue items: ${err.message}</div>`;
    }
  }

  function init() {
    if (!_loaded) render();
  }

  function refresh() {
    _loaded = false;
    render();
  }

  window.overdueWidget = {
    init, refresh,
    toggle: toggleCollapse,
    _openInquiry: openInquiry,
    _openCustomer: openCustomer,
  };
})();
