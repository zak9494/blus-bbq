/* ===== MODULE: PIPELINE LIST VIEW — Group 3 (Rule 14)
   File: static/js/list-view.js
   Loaded by: index.html when kanban_restructure flag is true.
   Depends on: window.statusSync, window.pipelineInqCache, window.showToast,
               window.showPage, window.openInquiry, window.loadPipelineInquiries
   Exposes: window.listView = { render, destroy }
   ===== */
(function () {
  'use strict';

  var STATUSES = [
    'needs_info', 'quote_drafted', 'quote_sent',
    'quote_approved', 'booked', 'completed', 'declined'
  ];

  var STATUS_LABELS = {
    needs_info:    'Need Info',
    quote_drafted: 'Quote Drafted',
    quote_sent:    'Quote Sent',
    quote_approved:'Waiting for Customer',
    booked:        'Booked',
    completed:     'Completed',
    declined:      'Lost'
  };

  /* ── State ── */
  var _sortKey  = 'created_at';
  var _sortAsc  = false;
  var _filters  = { status: '', dateRange: '', approvedOnly: false, hasBudget: false, hasPhone: false };
  var _search   = '';
  var _container = null;
  var _expandedNotes = new Set();

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

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function getCustomerEmail(inq) {
    var ef = inq.extracted_fields || {};
    if (ef.customer_email) return (ef.customer_email || '').toLowerCase().trim();
    var from = inq.from || '';
    var m = from.match(/<(.+?)>/);
    return m ? m[1].toLowerCase().trim() : from.toLowerCase().trim();
  }

  /* ── Filter + sort ── */

  function applyFiltersAndSort(data) {
    var now = new Date();

    var filtered = data.filter(function (inq) {
      // Status filter
      if (_filters.status && inq.status !== _filters.status) return false;

      // Date range filter
      if (_filters.dateRange && inq.event_date) {
        var d = new Date(inq.event_date + 'T00:00:00');
        if (_filters.dateRange === 'upcoming_30') {
          var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + 30);
          if (d < now || d > cutoff) return false;
        } else if (_filters.dateRange === 'upcoming_90') {
          var cut90 = new Date(now); cut90.setDate(cut90.getDate() + 90);
          if (d < now || d > cut90) return false;
        } else if (_filters.dateRange === 'past') {
          if (d >= now) return false;
        }
      }

      // Approved only
      if (_filters.approvedOnly && !inq.approved) return false;

      // Has budget
      if (_filters.hasBudget && !inq.budget) return false;

      // Has phone
      if (_filters.hasPhone) {
        var phone = (inq.extracted_fields && inq.extracted_fields.customer_phone) || inq.phone;
        if (!phone) return false;
      }

      // Free-text search across name, email, notes
      if (_search) {
        var q = _search.toLowerCase();
        var name  = (inq.customer_name || inq.from || '').toLowerCase();
        var email = getCustomerEmail(inq);
        var notes = (inq.notes || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !notes.includes(q)) return false;
      }

      return true;
    });

    // Sort
    filtered.sort(function (a, b) {
      var av, bv;
      switch (_sortKey) {
        case 'customer_name':
          av = (a.customer_name || a.from || '').toLowerCase();
          bv = (b.customer_name || b.from || '').toLowerCase();
          break;
        case 'event_date':
          av = a.event_date || '9999';
          bv = b.event_date || '9999';
          break;
        case 'status':
          av = STATUSES.indexOf(a.status);
          bv = STATUSES.indexOf(b.status);
          break;
        case 'amount':
          av = parseFloat(a.quote_total || a.budget || 0);
          bv = parseFloat(b.quote_total || b.budget || 0);
          break;
        default: // created_at
          av = a.email_date || a.created_at || a.threadId || '';
          bv = b.email_date || b.created_at || b.threadId || '';
      }
      if (av < bv) return _sortAsc ? -1 : 1;
      if (av > bv) return _sortAsc ? 1 : -1;
      return 0;
    });

    return filtered;
  }

  /* ── Render ── */

  function render(container) {
    _container = container;
    _draw();
  }

  function _draw() {
    if (!_container) return;
    var data = window.pipelineInqCache || [];
    var items = applyFiltersAndSort(data);

    // Hydrate statusSync
    if (window.statusSync && typeof window.statusSync._hydrate === 'function') {
      window.statusSync._hydrate(data);
    }

    var html = _buildToolbar(data) + _buildTable(items);
    _container.innerHTML = html;
    _bindEvents();
  }

  function _buildToolbar(data) {
    // Filter chips
    var statusChips = [{ val: '', lbl: 'All' }].concat(
      STATUSES.map(function (s) { return { val: s, lbl: STATUS_LABELS[s] || s }; })
    ).map(function (c) {
      var cnt = c.val ? data.filter(function (i) { return i.status === c.val; }).length : data.length;
      var act = _filters.status === c.val;
      return '<button class="lv-chip' + (act ? ' active' : '') + '" data-status="' + escHtml(c.val) + '">'
        + escHtml(c.lbl) + ' (' + cnt + ')</button>';
    }).join('');

    var toggleChips =
      '<label class="lv-toggle' + (_filters.approvedOnly ? ' active' : '') + '" data-toggle="approvedOnly">Approved</label>'
      + '<label class="lv-toggle' + (_filters.hasBudget ? ' active' : '') + '" data-toggle="hasBudget">Has Budget</label>'
      + '<label class="lv-toggle' + (_filters.hasPhone ? ' active' : '') + '" data-toggle="hasPhone">Has Phone</label>';

    var dateChips =
      '<button class="lv-chip' + (!_filters.dateRange ? ' active' : '') + '" data-date="">Any Date</button>'
      + '<button class="lv-chip' + (_filters.dateRange === 'upcoming_30' ? ' active' : '') + '" data-date="upcoming_30">Next 30d</button>'
      + '<button class="lv-chip' + (_filters.dateRange === 'upcoming_90' ? ' active' : '') + '" data-date="upcoming_90">Next 90d</button>'
      + '<button class="lv-chip' + (_filters.dateRange === 'past' ? ' active' : '') + '" data-date="past">Past</button>';

    return '<div class="lv-toolbar">'
      + '<div class="lv-toolbar-row">'
        + '<input class="lv-search form-input" id="lv-search" placeholder="Search name, email, notes\u2026" value="' + escHtml(_search) + '">'
      + '</div>'
      + '<div class="lv-toolbar-row">' + statusChips + '</div>'
      + '<div class="lv-toolbar-row">' + dateChips + toggleChips + '</div>'
      + '</div>';
  }

  function _colHdr(key, label) {
    var active = _sortKey === key;
    var arrow  = active ? (_sortAsc ? ' ↑' : ' ↓') : '';
    return '<th class="lv-th' + (active ? ' lv-th-active' : '') + '" data-sort="' + key + '">'
      + escHtml(label) + arrow + '</th>';
  }

  function _buildTable(items) {
    if (!items.length) {
      return '<div class="lv-empty">No inquiries match your filters.</div>';
    }

    var rows = items.map(function (inq) {
      var name   = escHtml(inq.customer_name || inq.from || 'Unknown');
      var email  = escHtml(getCustomerEmail(inq));
      var dot    = inq.has_unreviewed_update ? '<span class="inq-update-dot"></span>' : '';
      var evDate = escHtml(fmtDate(inq.event_date) || '—');
      var guests = escHtml(String(inq.guest_count || '—'));
      var amount = inq.quote_total
        ? '$' + parseFloat(inq.quote_total).toLocaleString()
        : (inq.budget ? '~$' + parseFloat(inq.budget).toLocaleString() : '—');

      // Status select
      var opts = STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (inq.status === s ? ' selected' : '') + '>' + (STATUS_LABELS[s] || s) + '</option>';
      }).join('');
      var sel = '<select class="lv-status-sel" data-tid="' + escHtml(inq.threadId) + '">' + opts + '</select>';

      // Notes (inline truncated + expand)
      var notes = inq.notes || '';
      var notesDisplay = _expandedNotes.has(inq.threadId)
        ? '<div class="lv-notes-full" data-tid="' + escHtml(inq.threadId) + '">'
            + '<textarea class="lv-notes-edit" data-tid="' + escHtml(inq.threadId) + '" rows="3">' + escHtml(notes) + '</textarea>'
            + '<button class="btn btn-sm lv-notes-save" data-tid="' + escHtml(inq.threadId) + '">Save</button>'
            + '<button class="btn btn-sm lv-notes-collapse" data-tid="' + escHtml(inq.threadId) + '">Collapse</button>'
          + '</div>'
        : '<div class="lv-notes-trunc" data-tid="' + escHtml(inq.threadId) + '">'
            + escHtml(notes.length > 60 ? notes.slice(0, 60) + '…' : (notes || '—'))
          + '</div>';

      // Repeat-customer badge (if canary from cache)
      var rcEmail = getCustomerEmail(inq);
      var rc = (window.kanbanView && window.kanbanView._rcCache && window.kanbanView._rcCache[rcEmail])
            || {};
      var rcBadge = rc.status && rc.status !== 'none'
        ? '<span class="kb-tag kb-tag-repeat" style="font-size:10px" title="'
            + escHtml(rc.status === 'booked_and_paid'
              ? 'Booked & paid ' + rc.bookedCount + 'x'
              : 'Prior inquiry')
            + '">' + (rc.status === 'booked_and_paid' ? '\u2b50' : '\u26a0\ufe0f') + '</span>'
        : '';

      return '<tr data-tid="' + escHtml(inq.threadId) + '">'
        + '<td><div class="td-name lv-name-popup" data-popup-tid="' + escHtml(inq.threadId) + '" title="Click for quick info">' + dot + name + ' ' + rcBadge + '</div><div class="td-email">' + email + '</div></td>'
        + '<td style="white-space:nowrap">' + evDate + '</td>'
        + '<td>' + guests + '</td>'
        + '<td>' + sel + '</td>'
        + '<td style="font-size:12px;color:var(--amber)">' + amount + '</td>'
        + '<td class="lv-notes-cell">' + notesDisplay + '</td>'
        + '<td><button class="btn btn-sm" data-open="' + escHtml(inq.threadId) + '">View</button></td>'
        + '</tr>';
    }).join('');

    return '<div class="leads-table-wrap lv-table-wrap">'
      + '<table class="lv-table">'
        + '<thead><tr>'
          + _colHdr('customer_name', 'Customer')
          + _colHdr('event_date', 'Event Date')
          + '<th>Guests</th>'
          + _colHdr('status', 'Status')
          + _colHdr('amount', 'Amount')
          + '<th>Notes</th>'
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
      + '</table>'
      + '</div>';
  }

  function _bindEvents() {
    if (!_container) return;

    // Search
    var searchEl = _container.querySelector('#lv-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        _search = searchEl.value;
        _draw();
      });
    }

    // Status chips
    _container.querySelectorAll('[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _filters.status = btn.getAttribute('data-status');
        _draw();
      });
    });

    // Date chips
    _container.querySelectorAll('[data-date]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _filters.dateRange = btn.getAttribute('data-date');
        _draw();
      });
    });

    // Toggle chips
    _container.querySelectorAll('[data-toggle]').forEach(function (lbl) {
      lbl.addEventListener('click', function () {
        var key = lbl.getAttribute('data-toggle');
        _filters[key] = !_filters[key];
        _draw();
      });
    });

    // Sort headers
    _container.querySelectorAll('[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (_sortKey === key) { _sortAsc = !_sortAsc; }
        else { _sortKey = key; _sortAsc = true; }
        _draw();
      });
    });

    // Status selects
    _container.querySelectorAll('.lv-status-sel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var tid = sel.getAttribute('data-tid');
        var newStatus = sel.value;
        if (!window.statusSync) return;
        if (newStatus === 'declined') {
          if (window.kanbanView && typeof window.kanbanView._openLostModal === 'function') {
            // reuse kanbanView lost modal
          }
        }
        window.statusSync.set(tid, newStatus).then(function () {
          if (typeof showToast === 'function') {
            showToast('Status \u2192 ' + (STATUS_LABELS[newStatus] || newStatus));
          }
          if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
        }).catch(function () {
          if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
        });
      });
    });

    // Notes expand (click on truncated text)
    _container.querySelectorAll('.lv-notes-trunc').forEach(function (el) {
      el.addEventListener('click', function () {
        var tid = el.getAttribute('data-tid');
        _expandedNotes.add(tid);
        _draw();
      });
      el.style.cursor = 'pointer';
      el.title = 'Click to expand / edit';
    });

    // Notes save
    _container.querySelectorAll('.lv-notes-save').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-tid');
        var ta  = _container.querySelector('.lv-notes-edit[data-tid="' + tid + '"]');
        if (!ta) return;
        var notes = ta.value;
        fetch('/api/inquiries/save?secret=' + encodeURIComponent(getSecret()), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: tid, notes: notes })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) {
            // Update cache
            var cache = window.pipelineInqCache || [];
            var idx = cache.findIndex(function (i) { return i.threadId === tid; });
            if (idx >= 0) cache[idx].notes = notes;
            _expandedNotes.delete(tid);
            if (typeof showToast === 'function') showToast('Notes saved \u2713');
            _draw();
          }
        }).catch(function () {});
      });
    });

    // Notes collapse
    _container.querySelectorAll('.lv-notes-collapse').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-tid');
        _expandedNotes.delete(tid);
        _draw();
      });
    });

    // Customer name → quick card popup (same component as kanban)
    _container.querySelectorAll('.lv-name-popup').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        var tid   = el.getAttribute('data-popup-tid');
        var cache = window.pipelineInqCache || [];
        var inq   = null;
        for (var i = 0; i < cache.length; i++) {
          if (cache[i].threadId === tid) { inq = cache[i]; break; }
        }
        if (!inq) return;
        if (window.kanbanView && typeof window.kanbanView._openPopup === 'function') {
          window.kanbanView._openPopup(inq, e);
        }
      });
    });

    // View button
    _container.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-open');
        if (typeof showPage === 'function') showPage('inquiries');
        if (typeof openInquiry === 'function') openInquiry(tid);
      });
    });
  }

  function destroy() {
    _container = null;
    _expandedNotes.clear();
  }

  window.listView = {
    render: render,
    destroy: destroy,
    _resetFilters: function () {
      _filters  = { status: '', dateRange: '', approvedOnly: false, hasBudget: false, hasPhone: false };
      _search   = '';
      _sortKey  = 'created_at';
      _sortAsc  = false;
      _expandedNotes.clear();
    }
  };

})();
