/* ===== MODULE: KANBAN RESTRUCTURE — Group 3 (Rule 14)
   File: static/js/kanban-view.js
   Loaded by: index.html when kanban_restructure flag is true.
   Depends on: window.statusSync, window.INQ_SECRET, window.pipelineInqCache,
               window.showToast, window.showPage, window.openInquiry,
               window.loadPipelineInquiries, window.flags
   Exposes: window.kanbanView = { render, destroy, setDateFilter,
              initDatePicker, destroyDatePicker, getColConfig, openColEditModal }
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

  var SERVICE_OPTIONS = [
    { val: '',               lbl: 'All Services' },
    { val: 'pickup',         lbl: 'Pickup' },
    { val: 'delivery',       lbl: 'Delivery' },
    { val: 'delivery_setup', lbl: 'Delivery & Setup' },
    { val: 'full_service',   lbl: 'Full Service' }
  ];

  var LOST_REASONS = [
    'Price',
    'Date conflict',
    'Went with competitor',
    'No response',
    'Other'
  ];

  /* ── State ── */
  var _dragThreadId    = null;
  var _dragSrcCol      = null;
  var _dpStart         = null;
  var _dpEnd           = null;
  var _dpPicker        = null;
  var _rcCache         = {};
  var _rcPending       = {};
  var _container       = null;
  var _kbServiceFilter = '';
  var _kbSortKey       = '';
  var _kbColConfig     = null;
  var _kbEditMode      = false;
  var _kbColEditorEl   = null;
  var _kbLongPressTimer = null;

  /* ── Utilities ── */

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

  function getServiceType(inq) {
    var ef = inq.extracted_fields || {};
    return (ef.service_type || inq.service_type || '').toLowerCase().replace(/[\s&]/g, '_');
  }

  function _flagOn(name) {
    return !!(window.flags && typeof window.flags.isEnabled === 'function' && window.flags.isEnabled(name));
  }

  /* ── Column config ── */

  function _loadColConfig() {
    try {
      var raw = localStorage.getItem('kb_col_config');
      if (raw) _kbColConfig = JSON.parse(raw);
    } catch (_) {}
    if (!_kbColConfig || !Array.isArray(_kbColConfig.order)) {
      _kbColConfig = { order: KANBAN_COLS.slice(), labels: {}, hidden: {} };
    }
    KANBAN_COLS.forEach(function (s) {
      if (_kbColConfig.order.indexOf(s) === -1) _kbColConfig.order.push(s);
    });
  }

  function _saveColConfig() {
    try { localStorage.setItem('kb_col_config', JSON.stringify(_kbColConfig)); } catch (_) {}
  }

  function _effectiveCols() {
    if (!_kbColConfig) return KANBAN_COLS.slice();
    return _kbColConfig.order.filter(function (c) { return !_kbColConfig.hidden[c]; });
  }

  function _colLabel(status) {
    if (_kbColConfig && _kbColConfig.labels && _kbColConfig.labels[status]) {
      return _kbColConfig.labels[status];
    }
    return KANBAN_LABELS[status] || status;
  }

  /* ── Sort ── */

  function _sortInqs(inqs) {
    if (!_kbSortKey) return inqs;
    return inqs.slice().sort(function (a, b) {
      var av, bv;
      if (_kbSortKey === 'event_date') {
        av = a.event_date || '9999'; bv = b.event_date || '9999';
      } else if (_kbSortKey === 'first_name') {
        av = (a.customer_name || a.from || '').toLowerCase().split(' ')[0];
        bv = (b.customer_name || b.from || '').toLowerCase().split(' ')[0];
      } else {
        var ap = (a.customer_name || a.from || '').toLowerCase().split(' ');
        var bp = (b.customer_name || b.from || '').toLowerCase().split(' ');
        av = ap[ap.length - 1]; bv = bp[bp.length - 1];
      }
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
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
      var label = rc.status === 'booked_and_paid' ? '\u2b50 Repeat' : '\u26a0\ufe0f Prior';
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
    var ef     = inq.extracted_fields || {};
    var name   = escHtml(inq.customer_name || inq.from || 'Unknown');
    var phone  = escHtml(ef.customer_phone || inq.phone || '');
    var ev     = inq.event_date ? fmtDate(inq.event_date) : 'Date TBD';
    var guests = inq.guest_count ? ' \u00b7 ' + inq.guest_count + ' guests' : '';
    var dot    = inq.has_unreviewed_update
      ? '<span class="inq-update-dot" title="New reply"></span>' : '';
    var email  = getCustomerEmail(inq);
    var ctpHtml = (window.tagPicker && email) ? window.tagPicker.renderChips(email) : '';

    var tags = '';

    if (inq.status === 'quote_sent') {
      var isScheduled = inq.scheduled_send_at && new Date(inq.scheduled_send_at) > new Date();
      tags += isScheduled
        ? '<span class="kb-tag kb-tag-scheduled" title="Queued via QStash, not yet sent">Scheduled</span>'
        : '<span class="kb-tag kb-tag-sent" title="Quote delivered to customer">Sent</span>';
    }

    if (inq.status === 'booked' && (inq.balance_due > 0 || inq.deposit_balance_due > 0)) {
      tags += '<span class="kb-tag kb-tag-pastdue" title="Outstanding balance">Past Due</span>';
    }

    var rc = _rcCache[email];
    if (rc && rc.status !== 'none') {
      var rcLabel = rc.status === 'booked_and_paid' ? '\u2b50 Repeat' : '\u26a0\ufe0f Prior';
      var rcTip   = rc.status === 'booked_and_paid'
        ? 'Booked & paid ' + rc.bookedCount + 'x' + (rc.lastEventDate ? ' \u00b7 last: ' + fmtDate(rc.lastEventDate) : '')
        : 'Prior inquiry, never booked (' + rc.count + ' previous)';
      tags += '<span class="kb-tag kb-tag-repeat" title="' + escHtml(rcTip) + '" data-rc-email="' + escHtml(email) + '">' + rcLabel + '</span>';
    }

    var opts = _effectiveCols().map(function (s) {
      return '<option value="' + s + '"' + (inq.status === s ? ' selected' : '') + '>'
        + escHtml(_colLabel(s)) + '</option>';
    }).join('');

    var div = document.createElement('div');
    div.className = 'kb-card';
    div.draggable = true;
    div.setAttribute('data-tid', inq.threadId);
    div.setAttribute('data-email', email);
    div.__inq__ = inq;
    div.innerHTML =
      '<div class="kb-card-name">' + dot + name + '</div>'
      + (phone ? '<div class="kb-card-phone">' + phone + '</div>' : '')
      + '<div class="kb-card-meta">' + escHtml(ev) + escHtml(guests) + '</div>'
      + (tags ? '<div class="kb-card-tags">' + tags + '</div>' : '<div class="kb-card-tags"></div>')
      + '<div class="kb-card-customer-tags" style="' + (ctpHtml ? '' : 'display:none') + '">' + ctpHtml + '</div>'
      + '<div class="kb-card-footer">'
        + '<select class="kb-status-sel" title="Move to status">' + opts + '</select>'
      + '</div>';

    div.addEventListener('click', function (e) {
      if (e.target.closest('.kb-status-sel') || e.target.closest('.kb-tag-repeat')) return;
      if (typeof showPage === 'function') showPage('inquiries');
      if (typeof openInquiry === 'function') openInquiry(inq.threadId);
    });

    div.querySelector('.kb-card-name').addEventListener('click', function (e) {
      if (e.target.closest('.kb-status-sel') || e.target.closest('.kb-tag-repeat')) return;
      e.stopPropagation();
      openCustomerPopup(inq, e);
    });

    var rcTagEl = div.querySelector('.kb-tag-repeat');
    if (rcTagEl) {
      rcTagEl.addEventListener('click', function (e) {
        e.stopPropagation();
        openCustomerPopup(inq, e);
      });
    }

    var sel = div.querySelector('.kb-status-sel');
    if (window.cardStatusDropdown) {
      window.cardStatusDropdown.wire(sel, inq, function (newStatus, lostReason) {
        _commitStatus(inq.threadId, newStatus, lostReason);
      });
    } else {
      sel.addEventListener('change', function (e) {
        e.stopPropagation();
        var newStatus = sel.value;
        if (newStatus === 'declined') {
          openLostModal(inq.threadId, inq.status, function (reason) {
            _commitStatus(inq.threadId, newStatus, reason);
          }, function () { sel.value = inq.status; });
        } else {
          _commitStatus(inq.threadId, newStatus, null);
        }
      });
    }

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

    if (email && !_rcCache[email] && !_rcPending[email]) fetchRcData(email, inq.threadId);

    return div;
  }

  /* ── Status commit ── */

  function _commitStatus(threadId, newStatus, lostReason) {
    var sync = window.statusSync;
    if (!sync) {
      if (typeof updateInquiryStatus === 'function') {
        updateInquiryStatus(threadId, newStatus).then(function () {
          if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
        });
      }
      return;
    }
    sync.set(threadId, newStatus).then(function () {
      if (lostReason) {
        fetch('/api/inquiries/save?secret=' + encodeURIComponent(getSecret()), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: threadId, lost_reason: lostReason })
        }).catch(function () {});
      }
      if (typeof showToast === 'function') showToast('Status \u2192 ' + _colLabel(newStatus));
      if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
    }).catch(function () {
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
    hdr.innerHTML =
      '<span class="kb-col-title">' + escHtml(_colLabel(status)) + '</span>'
      + '<div class="kb-col-hdr-right">'
        + '<span class="kb-col-count">' + cards.length + '</span>'
      + '</div>';

    if (_flagOn('kanban_edit_mode_v1')) _attachLongPress(hdr);

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
        if (window.lostReasonSheet) {
          window.lostReasonSheet.open(tid, function (reason) { _commitStatus(tid, newStatus, reason); }, function () {});
        } else {
          openLostModal(tid, _dragSrcCol, function (reason) { _commitStatus(tid, newStatus, reason); }, function () {});
        }
      } else {
        _commitStatus(tid, newStatus, null);
      }
    });

    col.appendChild(hdr);
    col.appendChild(body);
    return col;
  }

  /* ── Long-press handler ── */

  function _attachLongPress(el) {
    var start = function (e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      _kbLongPressTimer = setTimeout(function () {
        _kbLongPressTimer = null;
        openColEditModal();
      }, 500);
    };
    var cancel = function () {
      if (_kbLongPressTimer) { clearTimeout(_kbLongPressTimer); _kbLongPressTimer = null; }
    };
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
  }

  /* ── Toolbar ── */

  function _buildToolbarEl() {
    var toolbar = document.createElement('div');
    toolbar.className = 'kb-toolbar';
    toolbar.id = 'kb-toolbar';

    var chipsHtml = SERVICE_OPTIONS.map(function (o) {
      var active = _kbServiceFilter === o.val;
      return '<button class="kb-svc-chip' + (active ? ' active' : '') + '" data-svc="' + escHtml(o.val) + '">' + escHtml(o.lbl) + '</button>';
    }).join('');

    var sortHtml = '<select class="kb-sort-sel" id="kb-sort-sel">'
      + '<option value="">Sort: Default</option>'
      + '<option value="event_date"' + (_kbSortKey === 'event_date' ? ' selected' : '') + '>Event Date</option>'
      + '<option value="first_name"' + (_kbSortKey === 'first_name' ? ' selected' : '') + '>First Name</option>'
      + '<option value="last_name"' + (_kbSortKey === 'last_name' ? ' selected' : '') + '>Last Name</option>'
      + '</select>';

    var editBtnHtml = _flagOn('kanban_edit_mode_v1')
      ? '<button class="btn btn-sm" id="kb-edit-cols-btn" title="Edit column order, names &amp; visibility">Edit Columns</button>'
      : '';

    toolbar.innerHTML = '<div class="kb-toolbar-row">'
      + '<div class="kb-svc-chips">' + chipsHtml + '</div>'
      + '<div class="kb-toolbar-right">' + sortHtml + editBtnHtml + '</div>'
      + '</div>';

    toolbar.querySelectorAll('.kb-svc-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _kbServiceFilter = btn.getAttribute('data-svc');
        toolbar.querySelectorAll('.kb-svc-chip').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-svc') === _kbServiceFilter);
        });
        _rebuildBoard();
      });
    });

    var sortSel = toolbar.querySelector('#kb-sort-sel');
    if (sortSel) sortSel.addEventListener('change', function () { _kbSortKey = sortSel.value; _rebuildBoard(); });

    var editBtn = toolbar.querySelector('#kb-edit-cols-btn');
    if (editBtn) editBtn.addEventListener('click', function () { openColEditModal(); });

    return toolbar;
  }

  /* ── Board element builder ── */

  function _buildBoardEl() {
    var data = window.pipelineInqCache || [];
    var effectiveCols = _effectiveCols();

    var groups = {};
    effectiveCols.forEach(function (s) { groups[s] = []; });
    data.forEach(function (inq) {
      var s = inq.status || 'needs_info';
      if (groups[s] !== undefined) groups[s].push(inq);
    });

    // EOM hide completed
    if (!_flagOn('completed_eom_hide') && groups['completed']) {
      var nowKey = (function () { var n = new Date(); return n.getFullYear() * 100 + n.getMonth(); }());
      groups['completed'] = groups['completed'].filter(function (inq) {
        var ts = inq.completed_at || null;
        if (!ts) return true;
        var d = new Date(ts);
        if (isNaN(d.getTime())) return true;
        return d.getFullYear() * 100 + d.getMonth() === nowKey;
      });
    }

    // Lost auto-hide 48h
    if (_flagOn('lost_auto_hide_48h') && groups['declined']) {
      groups['declined'] = groups['declined'].filter(function (inq) {
        if (!inq.lost_at) return true;
        return (Date.now() - new Date(inq.lost_at).getTime()) < 48 * 60 * 60 * 1000;
      });
    }

    // Service filter
    if (_kbServiceFilter) {
      effectiveCols.forEach(function (s) {
        groups[s] = groups[s].filter(function (inq) { return getServiceType(inq) === _kbServiceFilter; });
      });
    }

    // Date-picker filter
    if (_dpStart || _dpEnd) {
      effectiveCols.forEach(function (s) {
        groups[s] = groups[s].filter(function (inq) {
          if (!inq.event_date) return true;
          var parts = String(inq.event_date).split('-');
          var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
          if (isNaN(d.getTime())) return true;
          if (_dpStart && d < _dpStart) return false;
          if (_dpEnd   && d > _dpEnd)   return false;
          return true;
        });
      });
    }

    // Sort within columns
    if (_kbSortKey) {
      effectiveCols.forEach(function (s) { groups[s] = _sortInqs(groups[s]); });
    }

    var board = document.createElement('div');
    board.className = 'kb-board';
    board.id = 'kb-board-inner';

    effectiveCols.forEach(function (s) {
      var colInqs = groups[s] || [];
      board.appendChild(buildColumn(s, colInqs.map(buildCard)));
    });

    return board;
  }

  /* ── Partial rebuild ── */

  function _rebuildBoard() {
    if (!_container) return;
    var old = _container.querySelector('#kb-board-inner');
    if (old) old.remove();
    _container.appendChild(_buildBoardEl());
    var data = window.pipelineInqCache || [];
    if (window.statusSync && typeof window.statusSync._hydrate === 'function') window.statusSync._hydrate(data);
  }

  /* ── Main render ── */

  function render(container) {
    if (!container) return;
    _container = container;
    if (!_kbColConfig) _loadColConfig();

    var data = window.pipelineInqCache || [];
    if (window.statusSync && typeof window.statusSync._hydrate === 'function') window.statusSync._hydrate(data);

    if (window.tagPicker) {
      var emails = [];
      data.forEach(function (inq) {
        var e = getCustomerEmail(inq);
        if (e && emails.indexOf(e) === -1) emails.push(e);
      });
      window.tagPicker.prefetch(emails);
    }

    container.innerHTML = '';
    container.appendChild(_buildToolbarEl());
    container.appendChild(_buildBoardEl());
  }

  function destroy() {
    var el = document.getElementById('kb-board-inner');
    if (el) el.remove();
    closeLostModal();
    closeCustomerPopup();
    _closeColEditor();
  }

  /* ── Column editor modal ── */

  function openColEditModal() {
    if (_kbColEditorEl) { _closeColEditor(); return; }
    if (!_kbColConfig) _loadColConfig();
    _kbEditMode = true;

    var overlay = document.createElement('div');
    overlay.className = 'kb-col-editor-overlay';
    overlay.id = 'kb-col-editor-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'kb-col-editor';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    _kbColEditorEl = overlay;

    overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeColEditor(); });
    document.addEventListener('keydown', _onEditorEsc);

    _renderColEditor(dialog);
  }

  function _onEditorEsc(e) { if (e.key === 'Escape') _closeColEditor(); }

  function _closeColEditor() {
    if (_kbColEditorEl) { _kbColEditorEl.remove(); _kbColEditorEl = null; }
    document.removeEventListener('keydown', _onEditorEsc);
    _kbEditMode = false;
  }

  function _renderColEditor(dialog) {
    if (!dialog || !_kbColConfig) return;
    var order = _kbColConfig.order;

    var rowsHtml = order.map(function (status, idx) {
      var isHidden = !!_kbColConfig.hidden[status];
      var label = _kbColConfig.labels[status] || KANBAN_LABELS[status] || status;
      return '<div class="kb-ep-row' + (isHidden ? ' kb-ep-hidden' : '') + '" draggable="true" data-col="' + escHtml(status) + '" data-idx="' + idx + '">'
        + '<span class="kb-ep-handle" title="Drag to reorder">\u2807</span>'
        + '<input class="kb-ep-label-inp" value="' + escHtml(label) + '" data-col="' + escHtml(status) + '" placeholder="Column name">'
        + '<label class="kb-ep-vis-lbl" title="Toggle visibility">'
          + '<input type="checkbox" class="kb-ep-vis-cb" ' + (isHidden ? '' : 'checked') + ' data-vis-col="' + escHtml(status) + '">'
          + '<span>' + (isHidden ? 'Hidden' : 'Visible') + '</span>'
        + '</label>'
      + '</div>';
    }).join('');

    dialog.innerHTML =
      '<div class="kb-ep-header">'
        + '<span class="kb-ep-title">Edit Columns</span>'
        + '<button class="btn btn-primary btn-sm kb-ep-done-btn">Done</button>'
      + '</div>'
      + '<p class="kb-ep-hint">Drag to reorder \u00b7 rename inline \u00b7 toggle visibility</p>'
      + '<div class="kb-ep-rows" id="kb-ep-rows">' + rowsHtml + '</div>';

    dialog.querySelector('.kb-ep-done-btn').addEventListener('click', _closeColEditor);

    dialog.querySelectorAll('.kb-ep-label-inp').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var col = inp.getAttribute('data-col');
        var val = inp.value.trim();
        if (val && val !== (KANBAN_LABELS[col] || col)) _kbColConfig.labels[col] = val;
        else delete _kbColConfig.labels[col];
        _saveColConfig(); _rebuildBoard(); _notifyListView();
      });
    });

    dialog.querySelectorAll('.kb-ep-vis-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var col = cb.getAttribute('data-vis-col');
        if (cb.checked) {
          delete _kbColConfig.hidden[col];
          cb.nextElementSibling.textContent = 'Visible';
          cb.closest('.kb-ep-row').classList.remove('kb-ep-hidden');
        } else {
          _kbColConfig.hidden[col] = true;
          cb.nextElementSibling.textContent = 'Hidden';
          cb.closest('.kb-ep-row').classList.add('kb-ep-hidden');
        }
        _saveColConfig(); _rebuildBoard(); _notifyListView();
      });
    });

    _bindColEditorDrag(dialog.querySelector('#kb-ep-rows'), dialog);
  }

  function _bindColEditorDrag(rowsEl, dialog) {
    if (!rowsEl) return;
    var dragSrcStatus = null;

    rowsEl.querySelectorAll('.kb-ep-row').forEach(function (row) {
      row.addEventListener('dragstart', function (e) {
        dragSrcStatus = row.getAttribute('data-col');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSrcStatus);
        row.classList.add('kb-ep-dragging');
      });
      row.addEventListener('dragend', function () {
        row.classList.remove('kb-ep-dragging');
        dragSrcStatus = null;
        rowsEl.querySelectorAll('.kb-ep-drag-target').forEach(function (r) { r.classList.remove('kb-ep-drag-target'); });
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        rowsEl.querySelectorAll('.kb-ep-drag-target').forEach(function (r) { r.classList.remove('kb-ep-drag-target'); });
        row.classList.add('kb-ep-drag-target');
      });
      row.addEventListener('dragleave', function () { row.classList.remove('kb-ep-drag-target'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('kb-ep-drag-target');
        var targetStatus = row.getAttribute('data-col');
        if (!dragSrcStatus || dragSrcStatus === targetStatus) return;
        var order = _kbColConfig.order;
        var srcIdx = order.indexOf(dragSrcStatus);
        var tgtIdx = order.indexOf(targetStatus);
        if (srcIdx === -1 || tgtIdx === -1) return;
        order.splice(srcIdx, 1);
        order.splice(tgtIdx, 0, dragSrcStatus);
        _saveColConfig();
        _renderColEditor(dialog);
        _rebuildBoard();
        _notifyListView();
      });
    });
  }

  function _notifyListView() {
    document.dispatchEvent(new CustomEvent('kbColConfigChanged'));
  }

  /* ── Customer summary popup ── */

  var _popupOverlay = null;
  var _popup = null;

  function openCustomerPopup(inq, triggerEvent) {
    closeCustomerPopup();

    var ef = inq.extracted_fields || {};
    var name     = escHtml(ef.customer_name || inq.customer_name || inq.from || 'Unknown');
    var rawEmail = getCustomerEmail(inq) || inq.from || '';
    var email    = escHtml(rawEmail);
    var phone    = escHtml(ef.customer_phone || inq.phone || '\u2014');

    var rc = _rcCache[getCustomerEmail(inq)] || {};
    var count    = rc.count || 0;
    var booked   = rc.bookedCount || 0;
    var lastDate = rc.lastEventDate ? fmtDate(rc.lastEventDate) : '\u2014';

    var cache    = window.pipelineInqCache || [];
    var emailKey = (getCustomerEmail(inq) || '').toLowerCase();
    var history  = cache.filter(function (i) {
      return i.threadId !== inq.threadId && getCustomerEmail(i) === emailKey;
    }).slice(0, 6);

    var historyHtml = history.length
      ? history.map(function (i) {
          return '<div class="kb-popup-history-row" onclick="openInquiry(\'' + escHtml(i.threadId) + '\')">'
            + '<span style="flex:1">' + escHtml(i.event_date || '\u2014') + '</span>'
            + '<span>' + escHtml(_colLabel(i.status) || i.status || '') + '</span>'
            + '<span style="color:var(--text3)">\u2192</span>'
            + '</div>';
        }).join('')
      : '<p style="font-size:11px;color:var(--text3);margin:0">No prior history in pipeline.</p>';

    _popupOverlay = document.createElement('div');
    _popupOverlay.className = 'kb-popup-overlay';
    _popupOverlay.addEventListener('click', closeCustomerPopup);
    document.body.appendChild(_popupOverlay);

    _popup = document.createElement('div');
    _popup.className = 'kb-popup';
    _popup.innerHTML =
      '<button class="kb-popup-close" onclick="window.kanbanView._closePopup()">\u00d7</button>'
      + '<div class="kb-popup-name">' + name + '</div>'
      + '<div class="kb-popup-email">' + email + (phone !== '\u2014' ? ' \u00b7 ' + phone : '') + '</div>'
      + '<div class="kb-popup-stat-row">'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + (count + 1) + '</div><div class="kb-popup-stat-lbl">Total inquiries</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + booked + '</div><div class="kb-popup-stat-lbl">Booked</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val kb-popup-stat-val-sm">' + lastDate + '</div><div class="kb-popup-stat-lbl">Last event</div></div>'
      + '</div>'
      + '<div class="kb-popup-history">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:6px">History</div>'
        + historyHtml
      + '</div>';

    if (rawEmail) {
      var moreRow = document.createElement('div');
      moreRow.style.cssText = 'margin-top:10px;text-align:right';
      var moreBtn = document.createElement('button');
      moreBtn.className = 'btn btn-sm';
      moreBtn.textContent = 'More info';
      moreBtn.addEventListener('click', function () {
        closeCustomerPopup();
        if (window.customerProfile && typeof window.customerProfile.show === 'function') {
          window.customerProfile.show(rawEmail);
        }
      });
      moreRow.appendChild(moreBtn);
      _popup.appendChild(moreRow);
    }

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

    document.addEventListener('keydown', _onPopupEsc);
  }

  function _onPopupEsc(e) { if (e.key === 'Escape') closeCustomerPopup(); }

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

    modal.innerHTML =
      '<h3>Why was this lead lost?</h3>'
      + '<p>Optional \u2014 helps track patterns over time.</p>'
      + '<div class="kb-lost-reasons">'
        + LOST_REASONS.map(function (r) {
            return '<button class="kb-lost-reason-btn" data-reason="' + escHtml(r) + '">' + escHtml(r) + '</button>';
          }).join('')
      + '</div>'
      + '<textarea class="kb-lost-reason-input" id="kb-lost-other-input" placeholder="Describe reason\u2026" rows="2"></textarea>'
      + '<div class="kb-lost-modal-footer">'
        + '<button class="btn" id="kb-lost-skip-btn">Skip</button>'
        + '<button class="btn btn-primary" id="kb-lost-submit-btn">Mark Lost</button>'
      + '</div>';

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
      closeLostModal(); onConfirm(null);
    });

    modal.querySelector('#kb-lost-submit-btn').addEventListener('click', function () {
      var reason = _selectedReason;
      if (reason === 'Other') {
        var inp = modal.querySelector('#kb-lost-other-input');
        reason = (inp.value || '').trim() || 'Other';
      }
      closeLostModal(); onConfirm(reason);
    });

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

  /* ── Date picker ── */

  function setDateFilter(start, end) { _dpStart = start || null; _dpEnd = end || null; }

  function initDatePicker(containerEl) {
    if (!containerEl || !window.DatePickerV2) return;
    if (_dpPicker) { _dpPicker.destroy(); _dpPicker = null; }
    _dpPicker = window.DatePickerV2.create({
      container: containerEl,
      presets: ['today','yesterday','this_week','last_week','last_7_days','this_month'],
      initialPreset: 'this_month',
      onChange: function (range) {
        setDateFilter(range.start, range.end);
        if (_container) _rebuildBoard();
      }
    });
    _dpPicker.mount();
  }

  function destroyDatePicker() {
    if (_dpPicker) { _dpPicker.destroy(); _dpPicker = null; }
    _dpStart = null; _dpEnd = null;
  }

  /* ── Public API ── */

  window.kanbanView = {
    render:             render,
    destroy:            destroy,
    setDateFilter:      setDateFilter,
    initDatePicker:     initDatePicker,
    destroyDatePicker:  destroyDatePicker,
    openColEditModal:   openColEditModal,
    getColConfig:       function () { return _kbColConfig; },
    colLabel:           _colLabel,
    _closePopup:        closeCustomerPopup,
    _openPopup:         openCustomerPopup,
    _rcCache:           _rcCache,
    _KANBAN_COLS:       KANBAN_COLS,
    _KANBAN_LABELS:     KANBAN_LABELS,
    _effectiveCols:     _effectiveCols
  };

})();
