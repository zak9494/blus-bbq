/* ===== MODULE: PIPELINE LIST VIEW — Group 3 (Rule 14)
   File: static/js/list-view.js
   Loaded by: index.html when kanban_restructure flag is true.
   Depends on: window.statusSync, window.pipelineInqCache, window.showToast,
               window.showPage, window.openInquiry, window.loadPipelineInquiries,
               window.kanbanView, window.flags
   Exposes: window.listView = { render, destroy, setDateFilter, destroyDatePicker }
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

  var SERVICE_OPTIONS = [
    { val: '', lbl: 'All Services' },
    { val: 'pickup',         lbl: 'Pickup' },
    { val: 'delivery',       lbl: 'Delivery' },
    { val: 'delivery_setup', lbl: 'Delivery & Setup' },
    { val: 'full_service',   lbl: 'Full Service' }
  ];

  var PER_PAGE_OPTIONS = [50, 100, 250];

  /* ── State ── */
  var _sortKey     = 'created_at';
  var _sortAsc     = false;
  var _filters     = { status: '', serviceType: '' };
  var _search      = '';
  var _container   = null;
  var _expandedNotes = new Set();
  var _dpStart     = null;
  var _dpEnd       = null;
  var _dpPicker    = null;
  var _perPage     = parseInt(localStorage.getItem('lv_perPage') || '50', 10);
  var _page        = 0;

  function _dpEnabled() {
    return !!(window.flags && typeof window.flags.isEnabled === 'function' && window.flags.isEnabled('date_picker_v2'));
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(d) {
    if (!d) return '';
    try { var p=d.split('-'); return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
    catch(_){ return d; }
  }

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function getCustomerEmail(inq) {
    var ef = inq.extracted_fields || {};
    if (ef.customer_email) return ef.customer_email.toLowerCase().trim();
    if (inq.customer_email) return inq.customer_email.toLowerCase().trim();
    var from = inq.from || '';
    var m = from.match(/<(.+?)>/);
    return m ? m[1].toLowerCase().trim() : from.toLowerCase().trim();
  }

  function getServiceType(inq) {
    var ef = inq.extracted_fields || {};
    return (ef.service_type || inq.service_type || '').toLowerCase().replace(/[\s&]/g,'_');
  }

  /* ── Filter + sort ── */

  function applyFiltersAndSort(data) {
    var lostHide = window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('lost_auto_hide_48h');

    var filtered = data.filter(function (inq) {
      // Status filter
      if (_filters.status && inq.status !== _filters.status) return false;

      // Service type filter
      if (_filters.serviceType) {
        var svc = getServiceType(inq);
        if (svc !== _filters.serviceType) return false;
      }

      // Lost 48h auto-hide (flag-gated)
      if (lostHide && inq.status === 'declined') {
        if (inq.lost_at && (Date.now() - new Date(inq.lost_at).getTime()) >= 48*60*60*1000) return false;
      }

      // Date-picker range filter (date_picker_v2 flag)
      if (_dpEnabled() && (_dpStart || _dpEnd) && inq.event_date) {
        var dpParts = String(inq.event_date).split('-');
        var dpD = new Date(+dpParts[0], +dpParts[1]-1, +dpParts[2]);
        if (!isNaN(dpD.getTime())) {
          if (_dpStart && dpD < _dpStart) return false;
          if (_dpEnd   && dpD > _dpEnd)   return false;
        }
      }

      // Free-text search
      if (_search) {
        var q = _search.toLowerCase();
        var name  = (inq.customer_name || inq.from || '').toLowerCase();
        var email = getCustomerEmail(inq);
        var notes = (inq.notes || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !notes.includes(q)) return false;
      }

      return true;
    });

    filtered.sort(function (a, b) {
      var av, bv;
      switch (_sortKey) {
        case 'customer_name':
          av=(a.customer_name||a.from||'').toLowerCase(); bv=(b.customer_name||b.from||'').toLowerCase(); break;
        case 'event_date':
          av=a.event_date||'9999'; bv=b.event_date||'9999'; break;
        case 'guest_count':
          av=parseFloat(a.guest_count||0); bv=parseFloat(b.guest_count||0); break;
        case 'status':
          av=STATUSES.indexOf(a.status); bv=STATUSES.indexOf(b.status); break;
        case 'amount':
          av=parseFloat(a.quote_total||a.budget||0); bv=parseFloat(b.quote_total||b.budget||0); break;
        default:
          av=a.email_date||a.created_at||a.threadId||''; bv=b.email_date||b.created_at||b.threadId||'';
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
    _page = 0;
    _draw();
  }

  function _draw() {
    if (!_container) return;
    var data = window.pipelineInqCache || [];
    var items = applyFiltersAndSort(data);

    if (window.statusSync && typeof window.statusSync._hydrate === 'function') {
      window.statusSync._hydrate(data);
    }

    var html = _buildToolbar(data) + _buildTable(items);
    _container.innerHTML = html;
    _bindEvents();
    if (_dpEnabled()) {
      var dpEl = document.getElementById('lv-date-picker-container');
      if (dpEl) {
        if (_dpPicker) { _dpPicker.destroy(); _dpPicker = null; }
        _dpPicker = window.DatePickerV2.create({
          container: dpEl,
          presets: ['today','yesterday','this_week','last_week','last_7_days','this_month'],
          noPastDates: true,
          initialPreset: 'this_month',
          onChange: function (range) {
            _dpStart = range.start || null;
            _dpEnd   = range.end   || null;
            _page = 0;
            _draw();
          }
        });
        _dpPicker.mount();
      }
    }
  }

  function _buildToolbar(data) {
    var statusChips = [{ val:'', lbl:'All' }].concat(
      STATUSES.map(function(s){ return { val:s, lbl:STATUS_LABELS[s]||s }; })
    ).map(function(c){
      var cnt = c.val ? data.filter(function(i){ return i.status===c.val; }).length : data.length;
      var act = _filters.status === c.val;
      return '<button class="lv-chip'+(act?' active':'')+'" data-status="'+escHtml(c.val)+'">'+escHtml(c.lbl)+' ('+cnt+')</button>';
    }).join('');

    var svcSelect = '<select class="lv-service-sel" id="lv-svc-sel">'
      + SERVICE_OPTIONS.map(function(o){
          return '<option value="'+o.val+'"'+(_filters.serviceType===o.val?' selected':'')+'>'+o.lbl+'</option>';
        }).join('')
      + '</select>';

    var perPageSel = '<select class="lv-per-page-sel" id="lv-per-page">'
      + PER_PAGE_OPTIONS.map(function(n){
          return '<option value="'+n+'"+(_perPage===n?' selected':'')+'>'+n+' / page</option>';
        }).join('')
      + '</select>';

    var dateSection = _dpEnabled()
      ? '<div id="lv-date-picker-container"></div>'
      : '';

    return '<div class="lv-toolbar">'
      + '<div class="lv-toolbar-row">'
        + '<input class="lv-search form-input" id="lv-search" placeholder="Search name, email, notes\u2026" value="'+escHtml(_search)+'">'
        + svcSelect
        + perPageSel
      + '</div>'
      + '<div class="lv-toolbar-row">'+statusChips+'</div>'
      + (dateSection ? '<div class="lv-toolbar-row">'+dateSection+'</div>' : '')
      + '</div>';
  }

  function _colHdr(key, label) {
    var active = _sortKey === key;
    var arrow  = active ? (_sortAsc ? ' ↑' : ' ↓') : '';
    return '<th class="lv-th'+(active?' lv-th-active':'')+'" data-sort="'+key+'">'+escHtml(label)+arrow+'</th>';
  }

  function _buildTable(items) {
    if (!items.length) {
      return '<div class="lv-empty">No inquiries match your filters.</div>';
    }

    // Pagination
    var totalPages = Math.ceil(items.length / _perPage) || 1;
    if (_page >= totalPages) _page = totalPages - 1;
    var pageItems = items.slice(_page * _perPage, (_page + 1) * _perPage);

    var rows = pageItems.map(function (inq) {
      var name   = escHtml(inq.customer_name || inq.from || 'Unknown');
      var email  = escHtml(getCustomerEmail(inq));
      var dot    = inq.has_unreviewed_update ? '<span class="inq-update-dot"></span>' : '';
      var evDate = escHtml(fmtDate(inq.event_date) || '—');
      var guests = escHtml(String(inq.guest_count || '—'));
      var amount = inq.quote_total
        ? '$' + parseFloat(inq.quote_total).toLocaleString()
        : (inq.budget ? '~$' + parseFloat(inq.budget).toLocaleString() : '—');

      var opts = STATUSES.map(function(s){
        return '<option value="'+s+'"'+(inq.status===s?' selected':'')+'>'+( STATUS_LABELS[s]||s)+'</option>';
      }).join('');
      var sel = '<select class="lv-status-sel" data-tid="'+escHtml(inq.threadId)+'">'+opts+'</select>';

      var notes = inq.notes || '';
      var notesDisplay = _expandedNotes.has(inq.threadId)
        ? '<div class="lv-notes-full" data-tid="'+escHtml(inq.threadId)+'">'
            +'<textarea class="lv-notes-edit" data-tid="'+escHtml(inq.threadId)+'" rows="3">'+escHtml(notes)+'</textarea>'
            +'<button class="btn btn-sm lv-notes-save" data-tid="'+escHtml(inq.threadId)+'">Save</button>'
            +'<button class="btn btn-sm lv-notes-collapse" data-tid="'+escHtml(inq.threadId)+'">Collapse</button>'
          +'</div>'
        : '<div class="lv-notes-trunc" data-tid="'+escHtml(inq.threadId)+'">'
            +escHtml(notes.length>60?notes.slice(0,60)+'\u2026':(notes||'—'))
          +'</div>';

      var rcEmail = getCustomerEmail(inq);
      var rc = (window.kanbanView && window.kanbanView._rcCache && window.kanbanView._rcCache[rcEmail]) || {};
      var rcBadge = rc.status === 'booked_and_paid'
        ? '<span class="kb-tag kb-tag-repeat" style="font-size:10px" title="Repeat \u00b7 '+rc.bookedCount+'x completed">\u2b50</span>'
        : '';

      return '<tr data-tid="'+escHtml(inq.threadId)+'">'
        + '<td><div class="td-name lv-name-popup" data-popup-tid="'+escHtml(inq.threadId)+'" title="Click for quick info">'+dot+name+' '+rcBadge+'</div><div class="td-email">'+email+'</div></td>'
        + '<td style="white-space:nowrap">'+evDate+'</td>'
        + '<td class="lv-guests-cell" data-popup-tid="'+escHtml(inq.threadId)+'" style="cursor:pointer;text-align:center" title="Click for customer info">'+guests+'</td>'
        + '<td>'+sel+'</td>'
        + '<td style="font-size:12px;color:var(--amber)">'+amount+'</td>'
        + '<td class="lv-notes-cell">'+notesDisplay+'</td>'
        + '<td><button class="btn btn-sm" data-open="'+escHtml(inq.threadId)+'">View</button></td>'
        + '</tr>';
    }).join('');

    // Pagination controls
    var pagingHtml = totalPages > 1
      ? '<div class="lv-paging">'
          + '<button class="lv-page-btn" data-paction="prev"'+((_page===0)?' disabled':'')+'>← Prev</button>'
          + ' <span class="lv-page-info">Page '+(_page+1)+' of '+totalPages+' ('+items.length+' total)</span> '
          + '<button class="lv-page-btn" data-paction="next"+((_page>=totalPages-1)?' disabled':'')+'>Next →</button>'
        + '</div>'
      : '<div class="lv-paging"><span class="lv-page-info">'+items.length+' results</span></div>';

    return '<div class="leads-table-wrap lv-table-wrap">'
      + '<table class="lv-table">'
        + '<thead><tr>'
          + _colHdr('customer_name','Customer')
          + _colHdr('event_date','Event Date')
          + _colHdr('guest_count','Guests')
          + _colHdr('status','Status')
          + _colHdr('amount','Amount')
          + '<th>Notes</th>'
          + '<th></th>'
        + '</tr></thead>'
        + '<tbody>'+rows+'</tbody>'
      + '</table>'
      + pagingHtml
      + '</div>';
  }

  function _bindEvents() {
    if (!_container) return;

    var searchEl = _container.querySelector('#lv-search');
    if (searchEl) searchEl.addEventListener('input', function(){ _search=searchEl.value; _page=0; _draw(); });

    var svcEl = _container.querySelector('#lv-svc-sel');
    if (svcEl) svcEl.addEventListener('change', function(){ _filters.serviceType=svcEl.value; _page=0; _draw(); });

    var perPageEl = _container.querySelector('#lv-per-page');
    if (perPageEl) perPageEl.addEventListener('change', function(){
      _perPage=parseInt(perPageEl.value,10); _page=0;
      localStorage.setItem('lv_perPage',String(_perPage));
      _draw();
    });

    _container.querySelectorAll('[data-status]').forEach(function(btn){
      btn.addEventListener('click', function(){ _filters.status=btn.getAttribute('data-status'); _page=0; _draw(); });
    });

    _container.querySelectorAll('[data-sort]').forEach(function(th){
      th.addEventListener('click', function(){
        var key=th.getAttribute('data-sort');
        if(_sortKey===key){_sortAsc=!_sortAsc;}else{_sortKey=key;_sortAsc=true;}
        _page=0; _draw();
      });
    });

    _container.querySelectorAll('[data-paction]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var action=btn.getAttribute('data-paction');
        if(action==='prev'&&_page>0){_page--;_draw();}
        else if(action==='next'){_page++;_draw();}
      });
    });

    _container.querySelectorAll('.lv-status-sel').forEach(function(sel){
      sel.addEventListener('change', function(){
        var tid=sel.getAttribute('data-tid'); var ns=sel.value;
        if(!window.statusSync)return;
        window.statusSync.set(tid,ns).then(function(){
          if(typeof showToast==='function')showToast('Status \u2192 '+(STATUS_LABELS[ns]||ns));
          if(typeof loadPipelineInquiries==='function')loadPipelineInquiries();
        }).catch(function(){if(typeof loadPipelineInquiries==='function')loadPipelineInquiries();});
      });
    });

    _container.querySelectorAll('.lv-notes-trunc').forEach(function(el){
      el.addEventListener('click', function(){ _expandedNotes.add(el.getAttribute('data-tid')); _draw(); });
      el.style.cursor='pointer'; el.title='Click to expand / edit';
    });

    _container.querySelectorAll('.lv-notes-save').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tid=btn.getAttribute('data-tid');
        var ta=_container.querySelector('.lv-notes-edit[data-tid="'+tid+'"]');
        if(!ta)return;
        var notes=ta.value;
        fetch('/api/inquiries/save?secret='+encodeURIComponent(getSecret()),
          {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:tid,notes:notes})})
          .then(function(r){return r.json();}).then(function(d){
            if(d.ok){
              var cache=window.pipelineInqCache||[];
              var idx=cache.findIndex(function(i){return i.threadId===tid;});
              if(idx>=0)cache[idx].notes=notes;
              _expandedNotes.delete(tid);
              if(typeof showToast==='function')showToast('Notes saved \u2713');
              _draw();
            }
          }).catch(function(){});
      });
    });

    _container.querySelectorAll('.lv-notes-collapse').forEach(function(btn){
      btn.addEventListener('click', function(){ _expandedNotes.delete(btn.getAttribute('data-tid')); _draw(); });
    });

    // Customer name + Guests cell → quick card popup
    _container.querySelectorAll('.lv-name-popup, .lv-guests-cell').forEach(function(el){
      el.style.cursor='pointer';
      el.addEventListener('click', function(e){
        var tid=el.getAttribute('data-popup-tid');
        var cache=window.pipelineInqCache||[];
        var inq=null;
        for(var i=0;i<cache.length;i++){if(cache[i].threadId===tid){inq=cache[i];break;}}
        if(!inq)return;
        if(window.kanbanView&&typeof window.kanbanView.openCustomerPopup==='function'){
          window.kanbanView.openCustomerPopup(inq,e);
        }
      });
    });

    _container.querySelectorAll('[data-open]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tid=btn.getAttribute('data-open');
        if(typeof showPage==='function')showPage('inquiries');
        if(typeof openInquiry==='function')openInquiry(tid);
      });
    });
  }

  function destroy() {
    if(_dpPicker){_dpPicker.destroy();_dpPicker=null;}
    _container=null; _expandedNotes.clear();
  }

  window.listView = {
    render: render,
    destroy: destroy,
    setDateFilter: function(start,end){ _dpStart=start||null; _dpEnd=end||null; },
    destroyDatePicker: function(){ if(_dpPicker){_dpPicker.destroy();_dpPicker=null;} _dpStart=null; _dpEnd=null; },
    _resetFilters: function(){
      _filters = { status:'', serviceType:'' };
      _search=''; _sortKey='created_at'; _sortAsc=false; _page=0;
      _expandedNotes.clear();
    }
  };

})();
