/* ===== MODULE: CALENDAR VIEW (Google Calendar)
   File: /static/js/calendar.js
   Depends on: window.INQ_SECRET, window.openInquiry (set by index.html inline script)
   Fetches events from /api/calendar/list (Google Calendar API backend).
   Renders month grid; day detail panel; + New Event modal; mobile list view.
   ===== */

(function () {
  'use strict';

  /* ── Constants ──────────────────────────────── */
  var MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  var DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  /* ── State ─────────────────────────────────── */
  var now      = new Date();
  var calYear  = now.getFullYear();
  var calMonth = now.getMonth();
  var calEvents   = [];   // Google Calendar event objects for displayed month
  var calLoaded   = false;
  var calLoading  = false;
  var selectedDay = null; // { year, month, day }

  /* ── Helpers ────────────────────────────────── */
  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function eventStartDate(ev) {
    var s = ev.start && (ev.start.dateTime || ev.start.date);
    if (!s) return null;
    // dateTime: "2026-05-15T12:00:00-05:00"
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }

  function formatTime(dateTimeStr) {
    if (!dateTimeStr) return '';
    var m = String(dateTimeStr).match(/T(\d{2}):(\d{2})/);
    if (!m) return '';
    var h = +m[1], mn = m[2];
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + mn + ' ' + ampm;
  }

  function bbqThreadId(ev) {
    return ev.extendedProperties && ev.extendedProperties.private &&
           ev.extendedProperties.private.blusBbqThreadId || '';
  }

  /* ── API ────────────────────────────────────── */
  async function loadEvents(year, month) {
    if (calLoading) return;
    calLoading = true;
    showStatus('Loading events\u2026');
    try {
      var secret = getSecret();
      var url = '/api/calendar/list?secret=' + encodeURIComponent(secret) +
                '&year=' + year + '&month=' + (month + 1);
      var r = await fetch(url);
      if (!r.ok) {
        var err = await r.json().catch(function() { return {}; });
        showError(err.error || ('HTTP ' + r.status));
        calEvents = [];
        calLoaded = true;
        return;
      }
      var d = await r.json();
      calEvents = d.events || [];
      calLoaded = true;
      hideStatus();
    } catch (e) {
      showError('Could not load calendar: ' + e.message);
      calEvents = [];
      calLoaded = true;
    } finally {
      calLoading = false;
    }
  }

  /* ── Render: month grid ─────────────────────── */
  function render() {
    renderHeader();
    renderGrid();
    if (selectedDay) renderDayPanel(selectedDay.year, selectedDay.month, selectedDay.day);
    else hideDayPanel();
  }

  function renderHeader() {
    var el = document.getElementById('cal-month-label');
    if (el) el.textContent = MONTH_NAMES[calMonth] + ' ' + calYear;
  }

  function renderGrid() {
    var gridEl = document.getElementById('cal-grid');
    if (!gridEl) return;

    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var startDow    = new Date(calYear, calMonth, 1).getDay();
    var today       = new Date();
    var isMobile    = window.innerWidth <= 640;

    // Index events by day for this month
    var byDay = {};
    calEvents.forEach(function(ev) {
      var d = eventStartDate(ev);
      if (!d || d.getFullYear() !== calYear || d.getMonth() !== calMonth) return;
      var day = d.getDate();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(ev);
    });

    // Mobile: render agenda list instead of grid
    if (isMobile) {
      renderAgenda(byDay, daysInMonth);
      return;
    }

    // Desktop: full month grid
    var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var html = '<div class="cal-dow-row">' +
      DOW.map(function(d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      '</div><div class="cal-weeks">';

    var totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    var dayNum = 1;
    for (var cell = 0; cell < totalCells; cell++) {
      if (cell % 7 === 0) html += '<div class="cal-week">';
      var inMonth = cell >= startDow && dayNum <= daysInMonth;
      var isToday = inMonth &&
        today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === dayNum;

      if (inMonth) {
        var events   = byDay[dayNum] || [];
        var hasEvs   = events.length > 0;
        var isSel    = selectedDay && selectedDay.year === calYear && selectedDay.month === calMonth && selectedDay.day === dayNum;
        var dn = dayNum;
        html += '<div class="cal-day' +
          (isToday ? ' cal-today' : '') +
          (hasEvs  ? ' cal-has-events' : '') +
          (isSel   ? ' cal-selected' : '') +
          '" onclick="window._calDayClick(' + calYear + ',' + calMonth + ',' + dn + ')">';
        html += '<div class="cal-day-num">' + dn + '</div>';
        if (hasEvs) {
          html += '<div class="cal-day-events">';
          var shown = Math.min(events.length, 3);
          for (var ei = 0; ei < shown; ei++) {
            var ev   = events[ei];
            var name = (ev.summary || 'Event').split('\u2014')[0].split('—')[0].trim();
            var tid  = bbqThreadId(ev);
            html += '<div class="cal-event"' +
              ' onclick="event.stopPropagation();window._calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
              '<span class="cal-event-dot"></span>' +
              '<span class="cal-event-name">' + escHtml(name) + '</span></div>';
          }
          if (events.length > 3) {
            html += '<div class="cal-event-overflow">+' + (events.length - 3) + ' more</div>';
          }
          html += '</div>';
        }
        html += '</div>';
        dayNum++;
      } else {
        html += '<div class="cal-day cal-day-empty"></div>';
      }
      if (cell % 7 === 6) html += '</div>';
    }
    html += '</div>';
    gridEl.innerHTML = html;
  }

  function renderAgenda(byDay, daysInMonth) {
    var gridEl = document.getElementById('cal-grid');
    if (!gridEl) return;
    var html = '<div class="cal-agenda">';
    var hasAny = false;
    for (var d = 1; d <= daysInMonth; d++) {
      var events = byDay[d];
      if (!events || !events.length) continue;
      hasAny = true;
      var today = new Date();
      var isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d;
      var dateStr = MONTH_NAMES[calMonth] + ' ' + d;
      html += '<div class="cal-agenda-date' + (isToday ? ' cal-today-agenda' : '') + '">' + dateStr + '</div>';
      events.forEach(function(ev) {
        var name = ev.summary || 'Catering Event';
        var time = formatTime(ev.start && ev.start.dateTime);
        var tid  = bbqThreadId(ev);
        html += '<div class="cal-agenda-event" onclick="window._calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
          '<div class="cal-agenda-event-name">' + escHtml(name) + '</div>' +
          (time ? '<div class="cal-agenda-event-time">' + time + '</div>' : '') +
          '</div>';
      });
    }
    if (!hasAny) html += '<div class="cal-agenda-empty">No events this month.</div>';
    html += '</div>';
    gridEl.innerHTML = html;
  }

  /* ── Day detail panel ───────────────────────── */
  function renderDayPanel(year, month, day) {
    var panel = document.getElementById('cal-day-panel');
    if (!panel) return;

    var dayEvents = calEvents.filter(function(ev) {
      var d = eventStartDate(ev);
      return d && d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });

    var dateLabel = DOW_FULL[new Date(year, month, day).getDay()] + ', ' + MONTH_NAMES[month] + ' ' + day + ', ' + year;
    var html = '<div class="cal-panel-header">' +
      '<span class="cal-panel-date">' + dateLabel + '</span>' +
      '<button class="cal-panel-close" onclick="window._calCloseDayPanel()" aria-label="Close">\u00d7</button>' +
      '</div>';

    if (dayEvents.length === 0) {
      html += '<div class="cal-panel-empty">No events on this day.' +
        ' <button class="cal-panel-add-btn" onclick="window._calOpenNewEvent(' +
        JSON.stringify(year + '-' + pad2(month+1) + '-' + pad2(day)) + ')">+ New Event</button></div>';
    } else {
      dayEvents.forEach(function(ev) {
        var startTime = formatTime(ev.start && ev.start.dateTime);
        var endTime   = formatTime(ev.end   && ev.end.dateTime);
        var timeRange = startTime ? (startTime + (endTime ? ' \u2013 ' + endTime : '')) : 'All day';
        var tid       = bbqThreadId(ev);
        var desc      = (ev.description || '').slice(0, 300);
        html += '<div class="cal-panel-event">' +
          '<div class="cal-panel-event-title">' + escHtml(ev.summary || 'Catering Event') + '</div>' +
          '<div class="cal-panel-event-time">' + timeRange + '</div>' +
          (ev.location ? '<div class="cal-panel-event-loc">\ud83d\udccd ' + escHtml(ev.location) + '</div>' : '') +
          (desc ? '<div class="cal-panel-event-desc">' + escHtml(desc) + '</div>' : '') +
          '<div class="cal-panel-event-actions">' +
          (tid ? '<button class="btn btn-sm" onclick="window._calOpenInquiry(' + JSON.stringify(tid) + ')">Open Inquiry</button>' : '') +
          (ev.htmlLink ? '<a class="btn btn-sm" href="' + ev.htmlLink + '" target="_blank" rel="noopener">View in Google Calendar</a>' : '') +
          '<button class="btn btn-sm cal-btn-danger" onclick="window._calDeleteEvent(' + JSON.stringify(ev.id) + ')">Delete</button>' +
          '</div></div>';
      });
      html += '<div class="cal-panel-footer">' +
        '<button class="btn btn-sm btn-primary" onclick="window._calOpenNewEvent(' +
        JSON.stringify(year + '-' + pad2(month+1) + '-' + pad2(day)) + ')">+ New Event</button></div>';
    }

    panel.innerHTML = html;
    panel.style.display = 'block';
  }

  function hideDayPanel() {
    var panel = document.getElementById('cal-day-panel');
    if (panel) panel.style.display = 'none';
  }

  /* ── New Event modal ────────────────────────── */
  function openNewEventModal(dateStr) {
    var modal = document.getElementById('cal-new-event-modal');
    if (!modal) return;
    var dateInput = document.getElementById('cal-ne-date');
    if (dateInput) dateInput.value = dateStr || '';
    modal.style.display = 'flex';
    var first = modal.querySelector('input, textarea');
    if (first) first.focus();
  }

  function closeNewEventModal() {
    var modal = document.getElementById('cal-new-event-modal');
    if (modal) modal.style.display = 'none';
    clearNewEventForm();
  }

  function clearNewEventForm() {
    ['cal-ne-customer','cal-ne-guests','cal-ne-date','cal-ne-time',
     'cal-ne-address','cal-ne-duration','cal-ne-notes'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var errEl = document.getElementById('cal-ne-error');
    if (errEl) errEl.textContent = '';
  }

  async function submitNewEvent() {
    var errEl = document.getElementById('cal-ne-error');
    var btn   = document.getElementById('cal-ne-submit');
    if (errEl) errEl.textContent = '';

    var fields = {
      customerName:  (document.getElementById('cal-ne-customer')  || {}).value || '',
      guestCount:    (document.getElementById('cal-ne-guests')    || {}).value || '',
      eventDate:     (document.getElementById('cal-ne-date')      || {}).value || '',
      eventTime:     (document.getElementById('cal-ne-time')      || {}).value || '',
      eventAddress:  (document.getElementById('cal-ne-address')   || {}).value || '',
      durationHours: (document.getElementById('cal-ne-duration')  || {}).value || '3',
      notes:         (document.getElementById('cal-ne-notes')     || {}).value || '',
      secret:        getSecret(),
    };

    if (!fields.eventDate) {
      if (errEl) errEl.textContent = 'Event date is required.';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }
    try {
      var r = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      var d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Create failed');
      closeNewEventModal();
      if (typeof window.showToast === 'function') window.showToast('Event created on Google Calendar');
      // Reload events for the displayed month
      await window.calRefresh();
    } catch(e) {
      if (errEl) errEl.textContent = e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Event'; }
    }
  }

  /* ── Delete event ───────────────────────────── */
  async function deleteEvent(eventId) {
    if (!window.confirm('Delete this event from Google Calendar?')) return;
    try {
      var r = await fetch('/api/calendar/delete?secret=' + encodeURIComponent(getSecret()) + '&eventId=' + encodeURIComponent(eventId), {
        method: 'DELETE',
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Delete failed');
      if (typeof window.showToast === 'function') window.showToast('Event deleted');
      selectedDay = null;
      await window.calRefresh();
    } catch(e) {
      if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message);
    }
  }

  /* ── Status/error helpers ───────────────────── */
  function showStatus(msg) {
    var el = document.getElementById('cal-loading');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function hideStatus() {
    var el = document.getElementById('cal-loading');
    if (el) el.style.display = 'none';
  }
  function showError(msg) {
    var el = document.getElementById('cal-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    hideStatus();
  }
  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ── Navigation ─────────────────────────────── */
  function prev() {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    calLoaded = false;
    calEvents = [];
    selectedDay = null;
    init();
  }

  function next() {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    calLoaded = false;
    calEvents = [];
    selectedDay = null;
    init();
  }

  function goToday() {
    var n = new Date();
    calYear  = n.getFullYear();
    calMonth = n.getMonth();
    calLoaded = false;
    calEvents = [];
    selectedDay = null;
    init();
  }

  /* ── Init / Refresh ─────────────────────────── */
  async function init() {
    hideError();
    if (!calLoaded) await loadEvents(calYear, calMonth);
    render();
  }

  function hideError() {
    var el = document.getElementById('cal-error');
    if (el) el.style.display = 'none';
  }

  async function refresh() {
    calLoaded = false;
    calEvents = [];
    hideError();
    await loadEvents(calYear, calMonth);
    render();
  }

  /* ── Window bindings (called from HTML) ─────── */
  window._calDayClick = function(year, month, day) {
    if (selectedDay && selectedDay.year === year && selectedDay.month === month && selectedDay.day === day) {
      selectedDay = null;
      hideDayPanel();
      renderGrid(); // re-render to remove selected class
    } else {
      selectedDay = { year: year, month: month, day: day };
      renderGrid();
      renderDayPanel(year, month, day);
    }
  };

  window._calCloseDayPanel = function() {
    selectedDay = null;
    hideDayPanel();
    renderGrid();
  };

  window._calEventClick = function(eventId, threadId) {
    if (threadId && typeof openInquiry === 'function') {
      openInquiry(threadId);
    }
  };

  window._calOpenInquiry = function(threadId) {
    if (typeof openInquiry === 'function') openInquiry(threadId);
  };

  window._calOpenNewEvent = function(dateStr) {
    openNewEventModal(dateStr);
  };

  window._calDeleteEvent = function(eventId) {
    deleteEvent(eventId);
  };

  window._calSubmitNewEvent = function() {
    submitNewEvent();
  };

  window._calCloseNewEvent = function() {
    closeNewEventModal();
  };

  window.calPrev    = prev;
  window.calNext    = next;
  window.calToday   = goToday;
  window.calInit    = init;
  window.calRefresh = refresh;
  window.calOpenNewEvent = openNewEventModal;

})();
