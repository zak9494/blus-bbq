/* ===== MODULE: KANBAN RESTRUCTURE — Group 3 (Rule 14)
   File: static/js/kanban-view.js
   Loaded by: index.html when kanban_restructure flag is true.
   Depends on: window.statusSync, window.INQ_SECRET, window.pipelineInqCache,
               window.showToast, window.showPage, window.openInquiry,
               window.loadPipelineInquiries
   Exposes: window.kanbanView = { render, destroy, openCustomerPopup, _rcCache }
   ===== */
(function () {
  'use strict';

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

  var TOTAL_COLS = { quote_sent: true, booked: true, completed: true };

  var SERVICE_LABELS = {
    '':               'All Services',
    pickup:           'Pickup',
    delivery:         'Delivery',
    delivery_setup:   'Delivery & Setup',
    full_service:     'Full Service'
  };

  var LOST_REASONS = ['Price', 'Date conflict', 'Went with competitor', 'No response', 'Other'];

  var _dragThreadId    = null;
  var _dragSrcCol      = null;
  var _rcCache         = {};
  var _rcPending       = {};
  var _kbSortKey       = 'event_date';
  var _kbServiceFilter = '';
  var _kbContainer     = null;

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      var p = d.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return d; }
  }

  function fmtMoney(n) {
    return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function getCustomerEmail(inq) {
    var ef = inq.extracted_fields || {};
    if (ef.customer_email) return ef.customer_email.toLowerCase().trim();
    if (inq.customer_email) return inq.customer_email.toLowerCase().trim();
    var from = inq.from || '';
    var m = from.match(/<(.+?)>/);
    return m ? m[1].toLowerCase().trim() : from.toLowerCase().trim();
  }

  function getCustomerPhone(inq) {
    var ef = inq.extracted_fields || {};
    return ef.customer_phone || inq.customer_phone || inq.phone || '';
  }

  function getServiceType(inq) {
    var ef = inq.extracted_fields || {};
    return ef.service_type || inq.service_type || '';
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
    if (rc && rc.status === 'booked_and_paid') {
      var tip = 'Repeat customer \u00b7 ' + rc.bookedCount + 'x completed'
        + (rc.lastEventDate ? ' \u00b7 last: ' + fmtDate(rc.lastEventDate) : '');
      var el = document.createElement('span');
      el.className = 'kb-tag kb-tag-repeat';
      el.textContent = '\u2b50 Repeat';
      el.setAttribute('title', tip);
      el.onclick = function (e) { e.stopPropagation(); openCustomerPopup(card.__inq__, e); };
      tagsEl.appendChild(el);
    }
  }

  function sortInqs(arr) {
    return arr.slice().sort(function (a, b) {
      var av, bv;
      if (_kbSortKey === 'first_name') {
        av = ((a.customer_name || a.from || '').trim().split(' ')[0] || '').toLowerCase();
        bv = ((b.customer_name || b.from || '').trim().split(' ')[0] || '').toLowerCase();
      } else if (_kbSortKey === 'last_name') {
        var ap = (a.customer_name || a.from || '').trim().split(' ');
        var bp = (b.customer_name || b.from || '').trim().split(' ');
        av = (ap[ap.length - 1] || '').toLowerCase();
        bv = (bp[bp.length - 1] || '').toLowerCase();
      } else {
        av = a.event_date || '9999-99-99';
        bv = b.event_date || '9999-99-99';
      }
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  function buildCard(inq) {
    var name   = escHtml(inq.customer_name || inq.from || 'Unknown');
    var ev     = inq.event_date ? fmtDate(inq.event_date) : 'Date TBD';
    var guests = inq.guest_count ? ' \u00b7 ' + inq.guest_count + ' guests' : '';
    var dot    = inq.has_unreviewed_update ? '<span class="inq-update-dot" title="New reply"></span>' : '';
    var email  = getCustomerEmail(inq);
    var phone  = getCustomerPhone(inq);
    var tags   = '';

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
    if (rc && rc.status === 'booked_and_paid') {
      var rcTip = 'Repeat customer \u00b7 ' + rc.bookedCount + 'x completed'
        + (rc.lastEventDate ? ' \u00b7 last: ' + fmtDate(rc.lastEventDate) : '');
      tags += '<span class="kb-tag kb-tag-repeat" title="' + escHtml(rcTip) + '" data-rc-email="' + escHtml(email) + '">\u2b50 Repeat</span>';
    }

    var opts = KANBAN_COLS.map(function (s) {
      return '<option value="' + s + '"' + (inq.status === s ? ' selected' : '') + '>' + (KANBAN_LABELS[s] || s) + '</option>';
    }).join('');

    var div = document.createElement('div');
    div.className = 'kb-card';
    div.draggable = true;
    div.setAttribute('data-tid', inq.threadId);
    div.setAttribute('data-email', email);
    div.__inq__ = inq;
    var ctpHtml = (window.tagPicker && email) ? window.tagPicker.renderChips(email) : '';

    div.innerHTML =
      '<div class="kb-card-name">' + dot + name + '</div>'
      + '<div class="kb-card-meta">' + escHtml(ev) + escHtml(guests) + '</div>'
      + (phone ? '<div class="kb-card-phone">' + escHtml(phone) + '</div>' : '')
      + (tags ? '<div class="kb-card-tags">' + tags + '</div>' : '<div class="kb-card-tags"></div>')
      + '<div class="kb-card-customer-tags" style="' + (ctpHtml ? '' : 'display:none') + '">' + ctpHtml + '</div>'
      + '<div class="kb-card-footer"><select class="kb-status-sel" title="Move to status">' + opts + '</select></div>';

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
    if (rcTagEl) rcTagEl.addEventListener('click', function (e) { e.stopPropagation(); openCustomerPopup(inq, e); });

    var sel = div.querySelector('.kb-status-sel');
    if (window.cardStatusDropdown) {
      window.cardStatusDropdown.wire(sel, inq, function (newStatus, lostReason) { _commitStatus(inq.threadId, newStatus, lostReason); });
    } else {
      sel.addEventListener('change', function (e) {
        e.stopPropagation();
        var newStatus = sel.value;
        if (newStatus === 'declined') {
          openLostModal(inq.threadId, inq.status, function (r) { _commitStatus(inq.threadId, newStatus, r); }, function () { sel.value = inq.status; });
        } else {
          _commitStatus(inq.threadId, newStatus, null);
        }
      });
    }

    div.addEventListener('dragstart', function (e) {
      _dragThreadId = inq.threadId; _dragSrcCol = inq.status;
      div.classList.add('kb-dragging'); e.dataTransfer.effectAllowed = 'move';
    });
    div.addEventListener('dragend', function () {
      div.classList.remove('kb-dragging'); _dragThreadId = null; _dragSrcCol = null;
    });

    if (email && !_rcCache[email] && !_rcPending[email]) fetchRcData(email, inq.threadId);
    return div;
  }

  function _commitStatus(threadId, newStatus, lostReason) {
    var sync = window.statusSync;
    if (!sync) {
      if (typeof updateInquiryStatus === 'function') {
        updateInquiryStatus(threadId, newStatus).then(function () { if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries(); });
      }
      return;
    }
    sync.set(threadId, newStatus).then(function () {
      if (lostReason) {
        fetch('/api/inquiries/save?secret=' + encodeURIComponent(getSecret()), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: threadId, lost_reason: lostReason })
        }).catch(function () {});
      }
      if (typeof showToast === 'function') showToast('Status \u2192 ' + (KANBAN_LABELS[newStatus] || newStatus));
      if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
    }).catch(function () { if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries(); });
  }

  function buildColumn(status, inqs) {
    var col = document.createElement('div');
    col.className = 'kb-col' + (inqs.length === 0 ? ' kb-col-empty' : '');
    col.setAttribute('data-col', status);

    var totalHtml = '';
    if (TOTAL_COLS[status]) {
      var sum = 0;
      inqs.forEach(function (inq) { var t = parseFloat(inq.quote_total); if (!isNaN(t) && t > 0) sum += t; });
      if (sum > 0) totalHtml = '<span class="kb-col-total">' + fmtMoney(sum) + '</span>';
    }

    var hdr = document.createElement('div');
    hdr.className = 'kb-col-hdr';
    hdr.innerHTML = '<span class="kb-col-title">' + escHtml(KANBAN_LABELS[status] || status) + '</span>'
      + '<span class="kb-col-hdr-right">' + totalHtml + '<span class="kb-col-count">' + inqs.length + '</span></span>';

    var body = document.createElement('div');
    body.className = 'kb-col-body';

    if (inqs.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'kb-col-empty-msg';
      msg.textContent = 'No leads here yet.';
      body.appendChild(msg);
    } else {
      inqs.forEach(function (inq) { body.appendChild(buildCard(inq)); });
    }

    body.addEventListener('dragover', function (e) {
      if (!_dragThreadId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('kb-drag-over');
    });
    body.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('kb-drag-over'); });
    body.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('kb-drag-over');
      var tid = _dragThreadId, newStatus = status;
      if (!tid || newStatus === _dragSrcCol) return;
      if (newStatus === 'declined') {
        if (window.lostReasonSheet) {
          window.lostReasonSheet.open(tid, function (r) { _commitStatus(tid, newStatus, r); }, function () {});
        } else {
          openLostModal(tid, _dragSrcCol, function (r) { _commitStatus(tid, newStatus, r); }, function () {});
        }
      } else {
        _commitStatus(tid, newStatus, null);
      }
    });

    col.appendChild(hdr);
    col.appendChild(body);
    return col;
  }

  function _buildToolbar(container) {
    var wrap = document.createElement('div');
    wrap.className = 'kb-toolbar';

    var sortSel = document.createElement('select');
    sortSel.className = 'kb-sort-sel form-select';
    sortSel.title = 'Sort all columns';
    [{ val: 'event_date', lbl: 'Event Date' }, { val: 'first_name', lbl: 'First Name' }, { val: 'last_name', lbl: 'Last Name' }]
      .forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.val; opt.textContent = o.lbl;
        if (o.val === _kbSortKey) opt.selected = true;
        sortSel.appendChild(opt);
      });
    sortSel.addEventListener('change', function () { _kbSortKey = sortSel.value; render(container); });

    var svcSel = document.createElement('select');
    svcSel.className = 'kb-service-sel form-select';
    svcSel.title = 'Filter by service type';
    Object.keys(SERVICE_LABELS).forEach(function (val) {
      var opt = document.createElement('option');
      opt.value = val; opt.textContent = SERVICE_LABELS[val];
      if (val === _kbServiceFilter) opt.selected = true;
      svcSel.appendChild(opt);
    });
    svcSel.addEventListener('change', function () { _kbServiceFilter = svcSel.value; render(container); });

    var sortLabel = document.createElement('label');
    sortLabel.className = 'kb-toolbar-label';
    sortLabel.textContent = 'Sort: ';
    sortLabel.appendChild(sortSel);

    var svcLabel = document.createElement('label');
    svcLabel.className = 'kb-toolbar-label';
    svcLabel.textContent = 'Service: ';
    svcLabel.appendChild(svcSel);

    wrap.appendChild(sortLabel);
    wrap.appendChild(svcLabel);
    return wrap;
  }

  function render(container) {
    if (!container) return;
    _kbContainer = container;
    var data = window.pipelineInqCache || [];

    if (window.statusSync && typeof window.statusSync._hydrate === 'function') window.statusSync._hydrate(data);

    if (window.tagPicker) {
      var emails = [];
      data.forEach(function (inq) { var e = getCustomerEmail(inq); if (e && emails.indexOf(e) === -1) emails.push(e); });
      window.tagPicker.prefetch(emails);
    }

    var visible = _kbServiceFilter
      ? data.filter(function (inq) { return getServiceType(inq) === _kbServiceFilter; })
      : data;

    var lostAutoHide = window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('lost_auto_hide_48h');
    if (lostAutoHide) {
      var cutoff48 = Date.now() - 48 * 60 * 60 * 1000;
      visible = visible.filter(function (inq) {
        if (inq.status !== 'declined') return true;
        var la = inq.lost_at ? new Date(inq.lost_at).getTime() : 0;
        return !la || la > cutoff48;
      });
    }

    var groups = {};
    KANBAN_COLS.forEach(function (s) { groups[s] = []; });
    visible.forEach(function (inq) {
      var s = inq.status || 'needs_info';
      if (!groups[s]) groups[s] = [];
      groups[s].push(inq);
    });

    var skipEomHide = window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('completed_eom_hide');
    if (!skipEomHide) {
      var nowKey = (function () { var n = new Date(); return n.getFullYear() * 100 + n.getMonth(); }());
      groups['completed'] = (groups['completed'] || []).filter(function (inq) {
        var ts = inq.completed_at || null;
        if (!ts) return true;
        var d = new Date(ts);
        if (isNaN(d.getTime())) return true;
        return d.getFullYear() * 100 + d.getMonth() === nowKey;
      });
    }

    KANBAN_COLS.forEach(function (s) { groups[s] = sortInqs(groups[s]); });

    container.innerHTML = '';
    container.appendChild(_buildToolbar(container));

    var board = document.createElement('div');
    board.className = 'kb-board';
    board.id = 'kb-board-inner';
    KANBAN_COLS.forEach(function (s) { board.appendChild(buildColumn(s, groups[s])); });
    container.appendChild(board);
  }

  function destroy() {
    var el = document.getElementById('kb-board-inner');
    if (el) el.remove();
    closeLostModal();
    closeCustomerPopup();
    _kbContainer = null;
  }

  var _popupOverlay = null;
  var _popup = null;

  function openCustomerPopup(inq, triggerEvent) {
    closeCustomerPopup();

    var rawName  = (inq.extracted_fields || {}).customer_name || inq.customer_name || inq.from || 'Unknown';
    var rawEmail = getCustomerEmail(inq);
    var rawPhone = getCustomerPhone(inq);
    var rc       = _rcCache[rawEmail] || {};
    var bookedCnt = rc.bookedCount || 0;

    var cache    = window.pipelineInqCache || [];
    var emailKey = rawEmail.toLowerCase();
    var allInqs  = cache.filter(function (i) { return getCustomerEmail(i) === emailKey; });
    var todayStr = new Date().toISOString().slice(0, 10);
    var upcoming = allInqs.filter(function (i) { return i.event_date && i.event_date >= todayStr; })
                          .sort(function (a, b) { return a.event_date < b.event_date ? -1 : 1; });
    var pastEvts = allInqs.filter(function (i) { return i.event_date && i.event_date < todayStr; })
                          .sort(function (a, b) { return a.event_date > b.event_date ? -1 : 1; });

    var eventLabel, eventVal;
    if (upcoming.length)      { eventLabel = 'Next event'; eventVal = fmtDate(upcoming[0].event_date); }
    else if (pastEvts.length) { eventLabel = 'Last event (past)'; eventVal = fmtDate(pastEvts[0].event_date); }
    else                      { eventLabel = 'Event'; eventVal = '\u2014'; }

    var history = allInqs.filter(function (i) { return i.threadId !== inq.threadId; }).slice(0, 6);
    var historyHtml = history.length
      ? history.map(function (i) {
          return '<div class="kb-popup-history-row" data-tid="' + escHtml(i.threadId) + '">'
            + '<span style="flex:1">' + escHtml(fmtDate(i.event_date) || '\u2014') + '</span>'
            + '<span class="kb-popup-history-status">' + escHtml(KANBAN_LABELS[i.status] || i.status || '') + '</span>'
            + '<span style="color:var(--text3)">\u2192</span></div>';
        }).join('')
      : '<p style="font-size:11px;color:var(--text3);margin:0">No other inquiries in pipeline.</p>';

    var emailHtml = rawEmail
      ? '<a href="mailto:' + escHtml(rawEmail) + '" class="kb-popup-link">' + escHtml(rawEmail) + '</a>'
      : '\u2014';
    var phoneHtml = rawPhone
      ? ' \u00b7 <a href="tel:' + escHtml(rawPhone) + '" class="kb-popup-link">' + escHtml(rawPhone) + '</a>'
      : '';

    _popupOverlay = document.createElement('div');
    _popupOverlay.className = 'kb-popup-overlay';
    _popupOverlay.addEventListener('click', closeCustomerPopup);
    document.body.appendChild(_popupOverlay);

    _popup = document.createElement('div');
    _popup.className = 'kb-popup';
    _popup.innerHTML =
      '<button class="kb-popup-close" onclick="window.kanbanView._closePopup()">\u00d7</button>'
      + '<div class="kb-popup-name">' + escHtml(rawName) + '</div>'
      + '<div class="kb-popup-email">' + emailHtml + phoneHtml + '</div>'
      + '<div class="kb-popup-stat-row">'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + allInqs.length + '</div><div class="kb-popup-stat-lbl">Total inquiries</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val">' + bookedCnt + '</div><div class="kb-popup-stat-lbl">Completed</div></div>'
        + '<div class="kb-popup-stat"><div class="kb-popup-stat-val kb-popup-stat-val-sm">' + escHtml(eventVal) + '</div><div class="kb-popup-stat-lbl">' + escHtml(eventLabel) + '</div></div>'
      + '</div>'
      + '<div class="kb-popup-history"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:6px">History</div>'
        + historyHtml + '</div>'
      + '<div class="kb-popup-actions"><button class="btn btn-sm kb-popup-view-btn" data-view-tid="' + escHtml(inq.threadId) + '">View inquiry</button></div>';

    _popup.querySelectorAll('.kb-popup-history-row[data-tid]').forEach(function (row) {
      row.addEventListener('click', function () {
        closeCustomerPopup();
        var tid = row.getAttribute('data-tid');
        if (typeof showPage === 'function') showPage('inquiries');
        if (typeof openInquiry === 'function') openInquiry(tid);
      });
    });

    var viewBtn = _popup.querySelector('.kb-popup-view-btn');
    if (viewBtn) {
      viewBtn.addEventListener('click', function () {
        closeCustomerPopup();
        var tid = viewBtn.getAttribute('data-view-tid');
        if (typeof showPage === 'function') showPage('inquiries');
        if (typeof openInquiry === 'function') openInquiry(tid);
      });
    }

    document.body.appendChild(_popup);
    if (triggerEvent && triggerEvent.clientX !== undefined) {
      var x = Math.min(triggerEvent.clientX + 12, window.innerWidth - 420);
      var y = Math.min(triggerEvent.clientY + 12, window.innerHeight - 380);
      _popup.style.left = Math.max(8, x) + 'px';
      _popup.style.top  = Math.max(8, y) + 'px';
    } else {
      _popup.style.left = '50%'; _popup.style.top = '50%';
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
      '<h3>Why was this lead lost?</h3><p>Optional \u2014 helps track patterns over time.</p>'
      + '<div class="kb-lost-reasons">' + reasonBtns + '</div>'
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

    modal.querySelector('#kb-lost-skip-btn').addEventListener('click', function () { closeLostModal(); onConfirm(null); });
    modal.querySelector('#kb-lost-submit-btn').addEventListener('click', function () {
      var reason = _selectedReason;
      if (reason === 'Other') { var inp = modal.querySelector('#kb-lost-other-input'); reason = (inp.value || '').trim() || 'Other'; }
      closeLostModal(); onConfirm(reason);
    });

    function onEsc(e) { if (e.key === 'Escape') { closeLostModal(); onCancel(); document.removeEventListener('keydown', onEsc); } }
    document.addEventListener('keydown', onEsc);
    _lostOverlay._onEsc = onEsc;
    _lostOverlay.appendChild(modal);
    document.body.appendChild(_lostOverlay);
  }

  function closeLostModal() {
    if (_lostOverlay) {
      if (_lostOverlay._onEsc) document.removeEventListener('keydown', _lostOverlay._onEsc);
      _lostOverlay.remove(); _lostOverlay = null;
    }
  }

  window.kanbanView = {
    render:            render,
    destroy:           destroy,
    openCustomerPopup: openCustomerPopup,
    _closePopup:       closeCustomerPopup,
    _openPopup:        openCustomerPopup,
    _rcCache:          _rcCache,
    _KANBAN_COLS:      KANBAN_COLS,
    _KANBAN_LABELS:    KANBAN_LABELS
  };

})();
