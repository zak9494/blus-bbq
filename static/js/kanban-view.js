/* ===== MODULE: KANBAN RESTRUCTURE — Group 3 (Rule 14)
   File: static/js/kanban-view.js
   Loaded by: index.html when kanban_restructure flag is true.
   Depends on: window.statusSync, window.INQ_SECRET, window.pipelineInqCache,
               window.showToast, window.showPage, window.openInquiry,
               window.loadPipelineInquiries
   Exposes: window.kanbanView = { render, destroy }
   ===== */
(function () {
  'use strict';

  /* ── Constants ── */
  var KANBAN_COLS = [
    'needs_info', 'quote_drafted', 'quote_sent',
    'quote_approved', 'booked', 'completed', 'declined'
  ];

  var KANBAN_LABELS = {
    needs_info:    'Need Info',
    quote_drafted: 'Quote Drafted',
    quote_sent:    'Quote Sent',
    quote_approved:'Waiting for Customer',
    booked:        'Booked',
    completed:     'Completed',
    declined:      'Lost'
  };

  var LOST_REASONS = [
    'Price',
    'Date conflict',
    'Went with competitor',
    'No response',
    'Other'
  ];

  /* ── State ── */
  var _dragThreadId = null;
  var _dragSrcCol   = null;
  var _rcCache      = {};   // email → { status, count, bookedCount, lastEventDate, lastAmount }
  var _rcPending    = {};   // email → true while fetch is in-flight

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      var p = d.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2])
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return d; }
  }

  /* ── Repeat-customer helpers ── */

  function getCustomerEmail(inq) {
    var ef = inq.extracted_fields || {};
    if (ef.customer_email) return (ef.customer_email || '').toLowerCase().trim();
    var from = inq.from || '';
    var m = from.match(/<(.+?)>/);
    return m ? m[1].toLowerCase().trim() : from.toLowerCase().trim();
  }

  function fetchRcData(email, threadId) {
    if (!email || _rcCache[email] || _rcPending[email]) return;
    _rcPending[email] = true;
    var url = '/api/pipeline/customer-history?secret=' + encodeURIComponent(getSecret()) +
              '&email=' + encodeURIComponent(email) +
              '&excludeThreadId=' + encodeURIComponent(threadId || '');
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _rcCache[email] = d;
        delete _rcPending[email];
        // Re-render tags for any visible card with this email
        document.querySelectorAll('.kb-card[data-email="' + CSS.escape(email) + '"]')
          .forEach(function (card) { _refreshCardTags(card, d); });
      })
      .catch(function () { delete _rcPending[email]; });
  }

  function _refreshCardTags(card, rc) {
    var tagsEl = card.querySelector('.kb-card-tags');
    if (!tagsEl) return;
    var rcTag = tagsEl.querySelector('.kb-tag-repeat');
    if (rcTag) rcTag.remove();
    if (rc && rc.status !== 'none') {
      var label = rc.status === 'booked_and_paid'
        ? '\u2b50 Repeat' : '\u26a0\ufe0f Prior';
      var tip = rc.status === 'booked_and_paid'
        ? 'Booked & paid ' + rc.bookedCount + 'x' + (rc.lastEventDate ? ' \u00b7 last: ' + fmtDate(rc.lastEventDate) : '')
        : 'Prior inquiry, never booked (' + rc.count + ' previous)';
      var el = document.createElement('span');
      el.className = 'kb-tag kb-tag-repeat';
      el.textContent = label;
      el.setAttribute('title', tip);
      el.onclick = function (e) {
        e.stopPropagation();
        openCustomerPopup(card.__inq__, e);
      };
      tagsEl.appendChild(el);
    }
  }

  /* ── Card builder ── */

  function buildCard(inq) {
    var name   = escHtml(inq.customer_name || inq.from || 'Unknown');
    var ev     = inq.event_date ? fmtDate(inq.event_date) : 'Date TBD';
    var guests = inq.guest_count ? ' \u00b7 ' + inq.guest_count + ' guests' : '';
    var dot    = inq.has_unreviewed_update
      ? '<span class="inq-update-dot" title="New reply"></span>' : '';
    var email  = getCustomerEmail(inq);

    // Tags
    var tags = '';

    // Quote Sent: Scheduled vs Sent tag
    if (inq.status === 'quote_sent') {
      var isScheduled = inq.scheduled_send_at && new Date(inq.scheduled_send_at) > new Date();
      if (isScheduled) {
        tags += '<span class="kb-tag kb-tag-scheduled" title="Queued via QStash, not yet sent">Scheduled</span>';
      } else {
        tags += '<span class="kb-tag kb-tag-sent" title="Quote delivered to customer">Sent</span>';
      }
    }

    // Past-due: only on booked with outstanding balance
    if (inq.status === 'booked' && (inq.balance_due > 0 || inq.deposit_balance_due > 0)) {
      tags += '<span class="kb-tag kb-tag-pastdue" title="Outstanding balance">Past Due</span>';
    }

    // Repeat-customer tag (filled in async by fetchRcData)
    var rc = _rcCache[email];
    if (rc && rc.status !== 'none') {
      var rcLabel = rc.status === 'booked_and_paid' ? '\u2b50 Repeat' : '\u26a0\ufe0f Prior';
      var rcTip   = rc.status === 'booked_and_paid'
        ? 'Booked & paid ' + rc.bookedCount + 'x' + (rc.lastEventDate ? ' \u00b7 last: ' + fmtDate(rc.lastEventDate) : '')
        : 'Prior inquiry, never booked (' + rc.count + ' previous)';
      tags += '<span class="kb-tag kb-tag-repeat" title="' + escHtml(rcTip) + '" data-rc-email="' + escHtml(email) + '">' + rcLabel + '</span>';
    }

    // Status selector options
    var opts = KANBAN_COLS.map(function (s) {
      return '<option value="' + s + '"' + (inq.status === s ? ' selected' : '') + '>'
        + (KANBAN_LABELS[s] || s) + '</option>';
    }).join('');

    var div = document.createElement('div');
    div.className = 'kb-card';
    div.draggable = true;
    div.setAttribute('data-tid', inq.threadId);
    div.setAttribute('data-email', email);
    div.__inq__ = inq; // keep reference for popup
    div.innerHTML =
      '<div class="kb-card-name">' + dot + name + '</div>'
      + '<div class="kb-card-meta">' + escHtml(ev) + escHtml(guests) + '</div>'
      + (tags ? '<div class="kb-card-tags">' + tags + '</div>' : '<div class="kb-card-tags"></div>')
      + '<div class="kb-card-footer">'
        + '<select class="kb-status-sel" title="Move to status">' + opts + '</select>'
      + '</div>';

    // Click on card body → open inquiry detail
    div.addEventListener('click', function (e) {
      if (e.target.closest('.kb-status-sel') || e.target.closest('.kb-tag-repeat')) return;
      if (typeof showPage === 'function') showPage('inquiries');
      if (typeof openInquiry === 'function') openInquiry(inq.threadId);
    });

    // Click on customer name → popup
    div.querySelector('.kb-card-name').addEventListener('click', function (e) {
      if (e.target.closest('.kb-status-sel') || e.target.closest('.kb-tag-repeat')) return;
      e.stopPropagation();
      openCustomerPopup(inq, e);
    });

    // Repeat-customer tag click
    var rcTagEl = div.querySelector('.kb-tag-repeat');
    if (rcTagEl) {
      rcTagEl.addEventListener('click', function (e) {
        e.stopPropagation();
        openCustomerPopup(inq, e);
      });
    }

    // Status select change → statusSync.set
    var sel = div.querySelector('.kb-status-sel');
    sel.addEventListener('change', function (e) {
      e.stopPropagation();
      var newStatus = sel.value;
      if (newStatus === 'declined') {
        openLostModal(inq.threadId, inq.status, function (reason) {
          _commitStatus(inq.threadId, newStatus, reason);
        }, function () {
          sel.value = inq.status; // cancel → restore
        });
      } else {
        _commitStatus(inq.threadId, newStatus, null);
      }
    });

    // DnD events
    div.addEventListener('dragstart', function (e) {
      _dragThreadId = inq.threadId;
      _dragSrcCol   = inq.status;
      div.classList.add('kb-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    div.addEventListener('dragend', function () {
      div.classList.remove('kb-dragging');
      _dragThreadId = null;
      _dragSrcCol   = null;
    });

    // Fetch RC data async if not cached
    if (email && !_rcCache[email] && !_rcPending[email]) {
      fetchRcData(email, inq.threadId);
    }

    return div;
  }

  /* ── Status commit ── */

  function _commitStatus(threadId, newStatus, lostReason) {
    var sync = window.statusSync;
    if (!sync) {
      // Fallback: call legacy updateInquiryStatus
      if (typeof updateInquiryStatus === 'function') {
        updateInquiryStatus(threadId, newStatus).then(function () {
          if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
        });
      }
      return;
    }

    var extra = {};
    if (lostReason) extra.lostReason = lostReason;

    sync.set(threadId, newStatus).then(function () {
      if (lostReason) {
        // Save lost_reason field
        fetch('/api/inquiries/save?secret=' + encodeURIComponent(getSecret()), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: threadId, lost_reason: lostReason })
        }).catch(function () {});
      }
      if (typeof showToast === 'function') {
        showToast('Status \u2192 ' + (KANBAN_LABELS[newStatus] || newStatus));
      }
      if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
    }).catch(function () {
      // rollback already handled by statusSync
      if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
    });
  }

  /* ── Column builder ── */

  function buildColumn(status, cards) {
    var col = document.createElement('div');
    col.className = 'kb-col' + (cards.length === 0 ? ' kb-col-empty' : '');
    col.setAttribute('data-col', status);

    var hdr = document.createElement('div');
    hdr.className = 'kb-col-hdr';
    hdr.innerHTML = '<span class="kb-col-title">' + escHtml(KANBAN_LABELS[status] || status) + '</span>'
      + '<span class="kb-col-count">' + cards.length + '</span>';

    var body = document.createElement('div');
    body.className = 'kb-col-body';

    if (cards.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'kb-col-empty-msg';
      msg.textContent = 'No leads here yet.';
      body.appendChild(msg);
    } else {
      cards.forEach(function (card) { body.appendChild(card); });
    }

    // Drop-zone events on col body
    body.addEventListener('dragover', function (e) {
      if (!_dragThreadId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('kb-drag-over');
    });

    body.addEventListener('dragleave', function (e) {
      if (!col.contains(e.relatedTarget)) col.classList.remove('kb-drag-over');
    });

    body.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('kb-drag-over');
      var tid = _dragThreadId;
      var newStatus = status;
      if (!tid || newStatus === _dragSrcCol) return;

      if (newStatus === 'declined') {
        openLostModal(tid, _dragSrcCol, function (reason) {
          _commitStatus(tid, newStatus, reason);
        }, function () {
          // cancel: no change
        });
      } else {
        _commitStatus(tid, newStatus, null);
      }
    });

    col.appendChild(hdr);
    col.appendChild(body);
    return col;
  }

  /* ── Main render ── */

  function render(container) {
    if (!container) return;

    var data = window.pipelineInqCache || [];

    // Hydrate statusSync
    if (window.statusSync && typeof window.statusSync._hydrate === 'function') {
      window.statusSync._hydrate(data);
    }

    // Group by status
    var groups = {};
    KANBAN_COLS.forEach(function (s) { groups[s] = []; });
    data.forEach(function (inq) {
      var s = inq.status || 'needs_info';
      if (!groups[s]) groups[s] = [];
      groups[s].push(inq);
    });

    // EOM hide: filter Completed column to current-month completions by default.
    // Flag 'completed_eom_hide' DISABLES this filter (flag OFF = EOM hide active).
    var skipEomHide = window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('completed_eom_hide');
    if (!skipEomHide) {
      var nowKey = (function () {
        var n = new Date(); return n.getFullYear() * 100 + n.getMonth();
      }());
      groups['completed'] = (groups['completed'] || []).filter(function (inq) {
        var ts = inq.completed_at || null;
        if (!ts) return true; // pre-Group4 records: show them
        var d = new Date(ts);
        if (isNaN(d.getTime())) return true;
        return d.getFullYear() * 100 + d.getMonth() === nowKey;
      });
    }

    var board = document.createElement('div');
    board.className = 'kb-board';
    board.id = 'kb-board-inner';

    KANBAN_COLS.forEach(function (s) {
      var cards = groups[s].map(buildCard);
      board.appendChild(buildColumn(s, cards));
    });

    container.innerHTML = '';
    container.appendChild(board);
  }

  function destroy() {
    var el = document.getElementById('kb-board-inner');
    if (el) el.remove();
    closeLostModal();
    closeCustomerPopup();
  }

  /* ── Customer summary popup ── */

  var _popupOverlay = null;
  var _popup = null;

  function openCustomerPopup(inq, triggerEvent) {
    closeCustomerPopup();

    var ef = inq.extracted_fields || {};
    var name  = escHtml(ef.customer_name || inq.customer_name || inq.from || 'Unknown');
    var email = escHtml(getCustomerEmail(inq) || inq.from || '');
    var phone = escHtml(ef.customer_phone || inq.phone || '—');

    var rc = _rcCache[getCustomerEmail(inq)] || {};
    var count     = rc.count || 0;
    var booked    = rc.bookedCount || 0;
    var lastDate  = rc.lastEventDate ? fmtDate(rc.lastEventDate) : '—';

    // Build history rows from pipelineInqCache
    var cache    = window.pipelineInqCache || [];
    var emailKey = (getCustomerEmail(inq) || '').toLowerCase();
    var history  = cache.filter(function (i) {
      return i.threadId !== inq.threadId && getCustomerEmail(i) === emailKey;
    }).slice(0, 6);

    var historyHtml = history.length
      ? history.map(function (i) {
          return '<div class="kb-popup-history-row" onclick="openInquiry(\'' + escHtml(i.threadId) + '\')">'
            + '<span style="flex:1">' + escHtml(i.event_date || '—') + '</span>'
            + '<span>' + escHtml(KANBAN_LABELS[i.status] || i.status || '') + '</span>'
            + '<span style="color:var(--text3)">\u2192</span>'
            + '</div>';
        }).join('')
      : '<p style="font-size:11px;color:var(--text3);margin:0">No prior history in pipeline.</p>';

    // Overlay
    _popupOverlay = document.createElement('div');
    _popupOverlay.className = 'kb-popup-overlay';
    _popupOverlay.addEventListener('click', closeCustomerPopup);
    document.body.appendChild(_popupOverlay);

    // Popup
    _popup = document.createElement('div');
    _popup.className = 'kb-popup';
    _popup.innerHTML =
      '<button class="kb-popup-close" onclick="window.kanbanView._closePopup()">\u00d7</button>'
      + '<div class="kb-popup-name">' + name + '</div>'
      + '<div class="kb-popup-email">' + email
        + (phone !== '—' ? ' \u00b7 ' + phone : '') + '</div>'
      + '<div class="kb-popup-stat-row">'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + (count + 1) + '</div><div class="kb-popup-stat-lbl">Total inquiries</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + booked + '</div><div class="kb-popup-stat-lbl">Booked</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val kb-popup-stat-val-sm">' + lastDate + '</div><div class="kb-popup-stat-lbl">Last event</div></div>'
      + '</div>'
      + '<div class="kb-popup-history">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:6px">History</div>'
        + historyHtml
      + '</div>';

    // Position near trigger
    document.body.appendChild(_popup);
    if (triggerEvent && triggerEvent.clientX !== undefined) {
      var x = Math.min(triggerEvent.clientX + 12, window.innerWidth - 400);
      var y = Math.min(triggerEvent.clientY + 12, window.innerHeight - 320);
      _popup.style.left = x + 'px';
      _popup.style.top  = y + 'px';
    } else {
      _popup.style.left = '50%';
      _popup.style.top  = '50%';
      _popup.style.transform = 'translate(-50%,-50%)';
    }

    // ESC to close
    document.addEventListener('keydown', _onPopupEsc);
  }

  function _onPopupEsc(e) {
    if (e.key === 'Escape') closeCustomerPopup();
  }

  function closeCustomerPopup() {
    if (_popupOverlay) { _popupOverlay.remove(); _popupOverlay = null; }
    if (_popup)        { _popup.remove();        _popup = null; }
    document.removeEventListener('keydown', _onPopupEsc);
  }

  /* ── Lost-reason modal ── */

  var _lostOverlay = null;
  var _selectedReason = null;

  function openLostModal(threadId, prevStatus, onConfirm, onCancel) {
    closeLostModal();
    _selectedReason = null;

    _lostOverlay = document.createElement('div');
    _lostOverlay.className = 'kb-lost-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'kb-lost-modal';

    var reasonBtns = LOST_REASONS.map(function (r) {
      return '<button class="kb-lost-reason-btn" data-reason="' + escHtml(r) + '">' + escHtml(r) + '</button>';
    }).join('');

    modal.innerHTML =
      '<h3>Why was this lead lost?</h3>'
      + '<p>Optional — helps track patterns over time.</p>'
      + '<div class="kb-lost-reasons">' + reasonBtns + '</div>'
      + '<textarea class="kb-lost-reason-input" id="kb-lost-other-input" placeholder="Describe reason\u2026" rows="2"></textarea>'
      + '<div class="kb-lost-modal-footer">'
        + '<button class="btn" id="kb-lost-skip-btn">Skip</button>'
        + '<button class="btn btn-primary" id="kb-lost-submit-btn">Mark Lost</button>'
      + '</div>';

    // Reason button clicks
    modal.querySelectorAll('.kb-lost-reason-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.querySelectorAll('.kb-lost-reason-btn').forEach(function (b) { b.classList.remove('kb-selected'); });
        btn.classList.add('kb-selected');
        _selectedReason = btn.getAttribute('data-reason');
        var inp = modal.querySelector('#kb-lost-other-input');
        inp.style.display = _selectedReason === 'Other' ? 'block' : 'none';
        if (_selectedReason === 'Other') inp.focus();
      });
    });

    modal.querySelector('#kb-lost-skip-btn').addEventListener('click', function () {
      closeLostModal();
      onConfirm(null);
    });

    modal.querySelector('#kb-lost-submit-btn').addEventListener('click', function () {
      var reason = _selectedReason;
      if (reason === 'Other') {
        var inp = modal.querySelector('#kb-lost-other-input');
        reason = (inp.value || '').trim() || 'Other';
      }
      closeLostModal();
      onConfirm(reason);
    });

    // ESC to cancel
    function onEsc(e) {
      if (e.key === 'Escape') { closeLostModal(); onCancel(); document.removeEventListener('keydown', onEsc); }
    }
    document.addEventListener('keydown', onEsc);
    _lostOverlay._onEsc = onEsc;

    _lostOverlay.appendChild(modal);
    document.body.appendChild(_lostOverlay);
  }

  function closeLostModal() {
    if (_lostOverlay) {
      if (_lostOverlay._onEsc) document.removeEventListener('keydown', _lostOverlay._onEsc);
      _lostOverlay.remove();
      _lostOverlay = null;
    }
  }

  /* ── Public API ── */

  window.kanbanView = {
    render: render,
    destroy: destroy,
    _closePopup: closeCustomerPopup,
    /* Expose for Playwright tests */
    _KANBAN_COLS: KANBAN_COLS,
    _KANBAN_LABELS: KANBAN_LABELS
  };

})();
