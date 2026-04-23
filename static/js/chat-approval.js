/* ===== MODULE: CHAT APPROVAL GATE (D24) =====
   Intercepts SEND_EMAIL_NOW:: calls from window.sendPrompt and
   stages them as approval cards in the AI chat.
   Queues items in KV via /api/chat/approval.
   Approve → /api/dispatch/email (send now)
   Schedule → /api/schedule (QStash, Rule 13)
   Edit → inline edit form, then send/schedule
   Reject → DELETE from queue, dismiss card
   ===================================================== */
(function () {
  'use strict';

  /* ── helpers ──────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  /* ── KV queue helpers ─────────────────────────────────────────────── */

  async function queueItem(item) {
    try {
      await fetch('/api/chat/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret(), item }),
      });
    } catch (e) { console.warn('approval queue write failed:', e); }
  }

  async function dequeueItem(id) {
    try {
      await fetch(
        '/api/chat/approval?secret=' + encodeURIComponent(secret()) +
        '&id=' + encodeURIComponent(id),
        { method: 'DELETE' }
      );
    } catch (e) { /* non-fatal */ }
  }

  /* ── send helpers ─────────────────────────────────────────────────── */

  async function doSendNow(item, actionsEl, cardEl) {
    actionsEl.innerHTML = '<span class="approval-status">Sending…</span>';
    try {
      const r = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          sendAt: new Date().toISOString(),
          payload: {
            to: item.to, name: item.name || item.to,
            subject: item.subject, body: item.body,
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      await dequeueItem(item.id);
      if (r.ok || d.ok || d.taskId) {
        cardEl.innerHTML =
          '<div class="approval-sent">✅ Email sent to ' + esc(item.to) + '</div>';
      } else {
        actionsEl.innerHTML =
          '<span class="approval-status error">Send failed: ' +
          esc(d.error || 'unknown error') + '</span>';
      }
    } catch (e) {
      actionsEl.innerHTML =
        '<span class="approval-status error">Send failed: ' + esc(e.message) + '</span>';
    }
  }

  /* ── immediate send for human-triggered SEND_EMAIL_NOW:: calls ────── */

  function doSendImmediate(raw) {
    fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        sendAt: new Date().toISOString(),
        payload: {
          to: raw.to || '',
          name: raw.name || raw.to || '',
          subject: raw.subject || '',
          body: raw.body || '',
        },
      }),
    }).catch(function (e) {
      console.error('chat-approval: immediate send failed', e);
    });
  }

  async function doSendScheduled(item, sendAt, actionsEl, cardEl) {
    actionsEl.innerHTML = '<span class="approval-status">Scheduling…</span>';
    try {
      const r = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email', sendAt, secret: secret(),
          payload: {
            to: item.to, name: item.name || item.to,
            subject: item.subject, body: item.body,
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      await dequeueItem(item.id);
      if (r.ok || d.ok || d.success) {
        cardEl.innerHTML =
          '<div class="approval-sent">📅 Email scheduled for ' +
          new Date(sendAt).toLocaleString() + '</div>';
      } else {
        actionsEl.innerHTML =
          '<span class="approval-status error">Schedule failed: ' +
          esc(d.error || 'unknown') + '</span>';
      }
    } catch (e) {
      actionsEl.innerHTML =
        '<span class="approval-status error">Schedule failed: ' + esc(e.message) + '</span>';
    }
  }

  /* ── schedule row toggle ──────────────────────────────────────────── */

  function toggleScheduleRow(wrap) {
    var row = wrap.querySelector('.approval-schedule-row');
    var visible = row.style.display === 'flex';
    row.style.display = visible ? 'none' : 'flex';
    if (!visible) {
      var dt = row.querySelector('.approval-dt');
      var d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dt.value = d.toISOString().slice(0, 16);
      dt.focus();
    }
  }

  /* ── edit form ────────────────────────────────────────────────────── */

  function showEditForm(item, wrap) {
    var card = wrap.querySelector('.approval-card');
    card.innerHTML =
      '<div class="approval-card-header">✏️ Edit Draft</div>' +
      '<div class="approval-edit-form">' +
        '<label>To</label>' +
        '<input type="email" class="edit-to" value="' + esc(item.to) + '">' +
        '<label>Subject</label>' +
        '<input type="text" class="edit-subject" value="' + esc(item.subject) + '">' +
        '<label>Body</label>' +
        '<textarea class="edit-body" rows="6">' + esc(item.body) + '</textarea>' +
        '<div class="approval-card-actions" style="margin-top:12px">' +
          '<button class="btn approval-save-edit">✅ Approve &amp; Send</button>' +
          '<button class="btn approval-cancel-edit">Cancel</button>' +
        '</div>' +
      '</div>';

    card.querySelector('.approval-save-edit').addEventListener('click', function () {
      var updated = {
        id: item.id,
        to: card.querySelector('.edit-to').value.trim(),
        name: item.name || item.to,
        subject: card.querySelector('.edit-subject').value.trim(),
        body: card.querySelector('.edit-body').value.trim(),
        createdAt: item.createdAt,
      };
      doSendNow(updated, card.querySelector('.approval-card-actions'), card);
    });

    card.querySelector('.approval-cancel-edit').addEventListener('click', function () {
      // Rebuild original card
      wrap.remove();
      renderApprovalCard(item);
    });
  }

  /* ── render approval card ─────────────────────────────────────────── */

  function renderApprovalCard(item) {
    var msgs = document.getElementById('chat-messages');
    if (!msgs) return null;

    var wrap = document.createElement('div');
    wrap.className = 'chat-msg ai approval-msg';
    wrap.dataset.approvalId = item.id;

    var avatar = document.createElement('div');
    avatar.className = 'chat-avatar ai';
    avatar.textContent = 'AI';

    var card = document.createElement('div');
    card.className = 'approval-card';
    card.innerHTML =
      '<div class="approval-card-header">📧 Email Draft — Awaiting Approval</div>' +
      '<div class="approval-card-field"><span class="approval-label">To:</span> <span class="approval-val">' + esc(item.to) + '</span></div>' +
      '<div class="approval-card-field"><span class="approval-label">Subject:</span> <span class="approval-val">' + esc(item.subject) + '</span></div>' +
      '<div class="approval-card-body">' + esc(item.body) + '</div>' +
      '<div class="approval-card-actions">' +
        '<button class="btn approval-approve">✅ Approve &amp; Send</button>' +
        '<button class="btn approval-schedule">📅 Schedule</button>' +
        '<button class="btn approval-edit">✏️ Edit</button>' +
        '<button class="btn approval-reject">✕ Reject</button>' +
      '</div>' +
      '<div class="approval-schedule-row" style="display:none">' +
        '<input type="datetime-local" class="approval-dt">' +
        '<button class="btn approval-send-scheduled">📤 Send Scheduled</button>' +
      '</div>';

    // Wire buttons
    card.querySelector('.approval-approve').addEventListener('click', function () {
      doSendNow(item, card.querySelector('.approval-card-actions'), card);
    });

    card.querySelector('.approval-schedule').addEventListener('click', function () {
      toggleScheduleRow(card);
    });

    card.querySelector('.approval-edit').addEventListener('click', function () {
      showEditForm(item, wrap);
    });

    card.querySelector('.approval-reject').addEventListener('click', function () {
      dequeueItem(item.id);
      card.innerHTML = '<div class="approval-sent" style="color:var(--text2)">✕ Draft rejected and discarded</div>';
    });

    card.querySelector('.approval-send-scheduled').addEventListener('click', function () {
      var dtVal = card.querySelector('.approval-dt').value;
      if (!dtVal) { alert('Please pick a send date/time.'); return; }
      doSendScheduled(
        item,
        new Date(dtVal).toISOString(),
        card.querySelector('.approval-card-actions'),
        card
      );
    });

    wrap.appendChild(avatar);
    wrap.appendChild(card);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }

  /* ── patch window.sendPrompt ──────────────────────────────────────── */

  var _orig = window.sendPrompt;
  window.sendPrompt = function (msg) {
    if (msg && typeof msg === 'string' && msg.startsWith('SEND_EMAIL_NOW::')) {
      try {
        var raw = JSON.parse(msg.slice('SEND_EMAIL_NOW::'.length));
        // Human-triggered sends (source: 'human') bypass the approval queue and fire
        // immediately via /api/schedule. Only source: 'ai' (or unset) goes to the queue.
        if (raw.source === 'human') {
          doSendImmediate(raw);
          return;
        }
        var item = {
          id: raw.id || ('ap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5)),
          to: raw.to || '',
          name: raw.name || raw.to || '',
          subject: raw.subject || '',
          body: raw.body || '',
          createdAt: new Date().toISOString(),
        };
        // Stage in KV (non-blocking)
        queueItem(item);
        // Show approval card immediately in chat
        renderApprovalCard(item);
      } catch (e) {
        console.error('chat-approval: parse error', e);
        if (typeof _orig === 'function') _orig.call(window, msg);
      }
      return;
    }
    if (typeof _orig === 'function') return _orig.call(window, msg);
  };

  /* ── chatApprovalInit — load any queued items on AI page open ─────── */

  window.chatApprovalInit = async function () {
    try {
      var r = await fetch('/api/chat/approval?secret=' + encodeURIComponent(secret()));
      var d = await r.json();
      if (d.ok && Array.isArray(d.items) && d.items.length) {
        // Render oldest first (array is newest-first from the queue)
        d.items.slice().reverse().forEach(function (item) {
          // Skip if card already rendered this session
          if (!document.querySelector('[data-approval-id="' + item.id + '"]')) {
            renderApprovalCard(item);
          }
        });
      }
    } catch (e) { /* non-fatal */ }
  };

})();
