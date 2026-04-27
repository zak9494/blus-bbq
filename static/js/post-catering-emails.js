/**
 * Post Catering Emails — subsection of the Scheduled view.
 *
 * Lists email tasks scheduled to send AFTER each inquiry's event_date
 * (thank-you notes, review requests, anniversary follow-ups). Per-row
 * actions: View / Edit / Reschedule / Cancel.
 *
 * Flag: post_catering_emails_v1 (default OFF)
 *
 * DOM contract — relies on these IDs being present in #page-scheduled:
 *   #pce-section   wrapper that we show/hide based on the flag
 *   #pce-list      container for the rendered cards
 *   #pce-empty     empty-state element
 *
 * Endpoint: GET /api/scheduled/post-catering
 */
(function () {
  'use strict';

  function flagOn() {
    return !!(window.flags && window.flags.isEnabled && window.flags.isEnabled('post_catering_emails_v1'));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function fmtEventDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function emailTypeLabel(t) {
    switch ((t || '').toLowerCase()) {
      case 'thank-you':       return '🙏 Thank-you';
      case 'review-request':  return '⭐ Review request';
      case 'anniversary':     return '🎉 Anniversary';
      default:                return '✉️ Follow-up';
    }
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.style.display = hidden ? 'none' : '';
  }

  function renderEmpty(list, empty) {
    setHidden(list, true);
    setHidden(empty, false);
    if (empty) empty.innerHTML =
      '<p>📭 No post-catering emails scheduled yet.</p>' +
      '<p style="color:var(--text2);font-size:0.9em">' +
      'Thank-you, review request, and anniversary emails queued to send AFTER an event' +
      ' will appear here.</p>';
  }

  function rowHtml(item) {
    const sendAt    = fmtDate(item.sendAt);
    const eventAt   = fmtEventDate(item.event_date);
    const name      = escapeHtml(item.customer_name || item.to || '(unknown customer)');
    const subj      = escapeHtml(item.subject || '(no subject)');
    const to        = escapeHtml(item.to || '');
    const typeLabel = escapeHtml(emailTypeLabel(item.emailType));
    const taskId    = escapeHtml(item.taskId);

    return '' +
      '<div class="pce-card sched-card" data-task-id="' + taskId + '">' +
        '<div class="sched-card-info">' +
          '<span class="sched-status sched-status-pending">⏰ Post-event</span>' +
          '<div class="sched-card-time">📅 Event: ' + escapeHtml(eventAt) +
              ' &nbsp;·&nbsp; 📧 Sends: ' + escapeHtml(sendAt) + '</div>' +
          '<div class="sched-card-preview">' +
            '<strong style="color:var(--text)">' + name + '</strong> &nbsp;' +
            '<span class="pce-type-chip">' + typeLabel + '</span><br>' +
            '<small style="color:var(--text2)">' + subj +
              (to ? ' &nbsp;·&nbsp; To: ' + to : '') + '</small>' +
          '</div>' +
        '</div>' +
        '<div class="sched-card-actions">' +
          '<button class="pce-btn pce-view"       data-task-id="' + taskId + '">View</button>' +
          '<button class="pce-btn pce-edit"       data-task-id="' + taskId + '">Edit</button>' +
          '<button class="pce-btn pce-reschedule" data-task-id="' + taskId + '">Reschedule</button>' +
          '<button class="pce-btn pce-cancel sched-cancel-btn" data-task-id="' + taskId + '">Cancel</button>' +
        '</div>' +
      '</div>';
  }

  let _itemsCache = [];

  function findItem(taskId) {
    return _itemsCache.find(i => i.taskId === taskId) || null;
  }

  function onView(taskId) {
    const it = findItem(taskId);
    if (!it) return;
    const lines = [
      'To: ' + (it.to || '(unset)'),
      'Customer: ' + (it.customer_name || '(unknown)'),
      'Event date: ' + fmtEventDate(it.event_date),
      'Sends at: ' + fmtDate(it.sendAt),
      'Type: ' + emailTypeLabel(it.emailType),
      '',
      'Subject: ' + (it.subject || '(no subject)'),
    ];
    if (typeof window.showToast === 'function') window.showToast('Opening preview…');
    try { alert(lines.join('\n')); } catch (e) {}
  }

  function onEdit(taskId) {
    if (typeof window.showToast === 'function') {
      window.showToast('Edit not yet implemented (wave 3 polish).');
    }
  }

  function onReschedule(taskId) {
    if (typeof window.showToast === 'function') {
      window.showToast('Reschedule not yet implemented (wave 3 polish).');
    }
  }

  async function onCancel(taskId) {
    if (!taskId) return;
    const ok = typeof window.confirm === 'function'
      ? window.confirm('Cancel this post-catering email?')
      : true;
    if (!ok) return;
    try {
      const r = await fetch('/api/tasks?taskId=' + encodeURIComponent(taskId), { method: 'DELETE' });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        if (typeof window.showToast === 'function') window.showToast('Cancel failed: ' + (t || r.status));
        return;
      }
      if (typeof window.showToast === 'function') window.showToast('Post-catering email cancelled.');
      await renderPostCatering();
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('Cancel failed: ' + (e && e.message));
    }
  }

  function bindRowActions(list) {
    if (!list || list._pceBound) return;
    list._pceBound = true;
    list.addEventListener('click', e => {
      const t = e.target;
      if (!t || !t.dataset || !t.dataset.taskId) return;
      const id = t.dataset.taskId;
      if (t.classList.contains('pce-view'))       return onView(id);
      if (t.classList.contains('pce-edit'))       return onEdit(id);
      if (t.classList.contains('pce-reschedule')) return onReschedule(id);
      if (t.classList.contains('pce-cancel'))     return onCancel(id);
    });
  }

  async function renderPostCatering() {
    const section = document.getElementById('pce-section');
    const list    = document.getElementById('pce-list');
    const empty   = document.getElementById('pce-empty');
    if (!section || !list) return;

    if (!flagOn()) {
      setHidden(section, true);
      return;
    }
    setHidden(section, false);
    bindRowActions(list);

    list.innerHTML = '<p style="color:var(--text2);padding:12px;text-align:center">Loading post-catering emails…</p>';
    setHidden(empty, true);

    try {
      const r = await fetch('/api/scheduled/post-catering');
      const d = await r.json().catch(() => ({}));
      const items = (d && d.items) || [];
      _itemsCache = items;
      if (!items.length) return renderEmpty(list, empty);
      setHidden(empty, true);
      list.innerHTML = items.map(rowHtml).join('');
      setHidden(list, false);
    } catch (e) {
      list.innerHTML = '<p style="color:var(--red);padding:12px">Failed to load post-catering emails.</p>';
    }
  }

  window.renderPostCatering = renderPostCatering;
})();
