/* ===== MODULE: CALENDAR VIEW (Google Calendar – Day/Week/Month)
   File: /static/js/calendar.js
   Depends on: window.INQ_SECRET, window.openInquiry (set by index.html inline script)
   Fetches events from /api/calendar/list (Google Calendar API backend).
   Views: Month grid, Week time-grid, Day agenda. Mobile: Week collapses to day-list.
   ===== */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────── */
  var MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW_FULL     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DOW_SHORT    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var HOUR_HEIGHT  = 48;   // px per hour in time-grid views
  var DAY_START    = 6;    // first visible hour (6 AM)
  var DAY_END      = 22;   // last visible hour (10 PM)
  var MOBILE_BP    = 480;  // px threshold for mobile layout

  /* ── State ───────────────────────────────────── */
  var calView         = window.innerWidth <= MOBILE_BP ? 'day' : 'month';
  var calDate         = new Date();   // anchor: always local-midnight via new Date(y,m,d)
  var calEventsCache  = {};           // 'YYYY-M' (0-indexed month) → events[]
  var calPendingLoads = {};           // 'YYYY-M' → Promise (dedup in-flight fetches)

  /* ── Helpers ─────────────────────────────────── */
  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* Parse a Google Calendar dateTime string.
     The string already carries the Chicago offset ("…T12:00:00-05:00"),
     so we read the wall-clock values directly rather than converting from UTC. */
  function parseCalDT(dtStr) {
    if (!dtStr) return null;
    var m = String(dtStr).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return { year: +m[1], month: +m[2] - 1, day: +m[3],
             hour: m[4] !== undefined ? +m[4] : 0,
             minute: m[5] !== undefined ? +m[5] : 0 };
  }

  function eventStart(ev) { return parseCalDT(ev.start && (ev.start.dateTime || ev.start.date)); }
  function eventEnd(ev)   { return parseCalDT(ev.end   && (ev.end.dateTime   || ev.end.date));   }

  function formatTime12(h, min) {
    var ampm = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + pad2(min) + '\u202f' + ampm;
  }

  function bbqThreadId(ev) {
    return (ev.extendedProperties && ev.extendedProperties.private &&
            ev.extendedProperties.private.blusBbqThreadId) || '';
  }

  function eventName(ev) {
    return (ev.summary || 'Event').split('\u2014')[0].split('—')[0].trim();
  }

  /* Today's date components in America/Chicago */
  function todayChi() {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    var p = {};
    fmt.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { year: +p.year, month: +p.month - 1, day: +p.day };
  }

  function sameDay(a, b) {
    return a && b && a.year === b.year && a.month === b.month && a.day === b.day;
  }

  /* The 7 days (Sun–Sat) of the week containing `date` */
  function getWeekDates(date) {
    var y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    var dow = new Date(y, m, d).getDay();
    var days = [];
    for (var i = 0; i < 7; i++) {
      var cur = new Date(y, m, d - dow + i);
      days.push({ year: cur.getFullYear(), month: cur.getMonth(), day: cur.getDate() });
    }
    return days;
  }

  /* ── API ─────────────────────────────────────── */
  function loadMonthEvents(year, month) {
    var key = year + '-' + month;
    if (calEventsCache[key]) return Promise.resolve(calEventsCache[key]);
    if (calPendingLoads[key]) return calPendingLoads[key];
    var url = '/api/calendar/list?secret=' + encodeURIComponent(getSecret()) +
              '&year=' + year + '&month=' + (month + 1);
    calPendingLoads[key] = fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        calEventsCache[key] = d.events || [];
        delete calPendingLoads[key];
        return calEventsCache[key];
      })
      .catch(function () {
        delete calPendingLoads[key];
        return [];
      });
    return calPendingLoads[key];
  }

  /* Which year-month pairs the current view needs */
  function viewMonths() {
    if (calView === 'month') {
      return [[calDate.getFullYear(), calDate.getMonth()]];
    }
    if (calView === 'week') {
      var days = getWeekDates(calDate);
      var first = days[0], last = days[6];
      var pairs = [];
      var y = first.year, m = first.month;
      while (y < last.year || (y === last.year && m <= last.month)) {
        pairs.push([y, m]);
        if (++m > 11) { m = 0; y++; }
      }
      return pairs;
    }
    /* day */
    return [[calDate.getFullYear(), calDate.getMonth()]];
  }

  function ensureLoaded() {
    return Promise.all(viewMonths().map(function (ym) {
      return loadMonthEvents(ym[0], ym[1]);
    }));
  }

  /* Return events whose start falls within [startComp … endComp] (inclusive),
     where each comp is {year,month,day}. */
  function eventsInRange(startComp, endComp) {
    var key = function (c) { return c.year * 10000 + c.month * 100 + c.day; };
    var lo = key(startComp), hi = key(endComp);
    var result = [];
    Object.keys(calEventsCache).forEach(function (k) {
      calEventsCache[k].forEach(function (ev) {
        var s = eventStart(ev);
        if (!s) return;
        var d = key(s);
        if (d >= lo && d <= hi) result.push(ev);
      });
    });
    result.sort(function (a, b) {
      var sa = eventStart(a), sb = eventStart(b);
      if (!sa || !sb) return 0;
      return (sa.hour * 60 + sa.minute) - (sb.hour * 60 + sb.minute);
    });
    return result;
  }

  /* ── Render dispatcher ───────────────────────── */
  function render() {
    updateHeader();
    updateViewButtons();
    var container = document.getElementById('cal-view-container');
    if (!container) return;
    if (calView === 'month')      renderMonth(container);
    else if (calView === 'week')  renderWeek(container);
    else                          renderDay(container);
  }

  /* ── Header title ────────────────────────────── */
  function updateHeader() {
    var el = document.getElementById('cal-range-label');
    if (!el) return;
    var y = calDate.getFullYear(), m = calDate.getMonth(), d = calDate.getDate();
    if (calView === 'month') {
      el.textContent = MONTH_NAMES[m] + ' ' + y;
    } else if (calView === 'week') {
      var days = getWeekDates(calDate);
      var f = days[0], l = days[6];
      if (f.year !== l.year) {
        el.textContent = MONTH_SHORT[f.month] + '\u00a0' + f.day + ', ' + f.year + '\u2009–\u2009' +
                         MONTH_SHORT[l.month] + '\u00a0' + l.day + ', ' + l.year;
      } else if (f.month !== l.month) {
        el.textContent = MONTH_SHORT[f.month] + '\u00a0' + f.day + '\u2009–\u2009' +
                         MONTH_SHORT[l.month] + '\u00a0' + l.day + ', ' + l.year;
      } else {
        el.textContent = MONTH_NAMES[f.month] + '\u00a0' + f.day + '–' + l.day + ', ' + l.year;
      }
    } else {
      var dow = new Date(y, m, d).getDay();
      el.textContent = DOW_FULL[dow] + ', ' + MONTH_NAMES[m] + '\u00a0' + d + ', ' + y;
    }
  }

  function updateViewButtons() {
    ['day', 'week', 'month'].forEach(function (v) {
      var btn = document.getElementById('cal-view-' + v);
      if (btn) btn.classList.toggle('cal-view-btn-active', calView === v);
    });
  }

  /* ── Month view ───────────────────────────────── */
  function renderMonth(container) {
    var year = calDate.getFullYear(), month = calDate.getMonth();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var startDow    = new Date(year, month, 1).getDay();
    var prevLast    = new Date(year, month, 0).getDate();
    var today       = todayChi();
    var byDay = {};
    (calEventsCache[year + '-' + month] || []).forEach(function (ev) {
      var s = eventStart(ev);
      if (!s || s.year !== year || s.month !== month) return;
      (byDay[s.day] || (byDay[s.day] = [])).push(ev);
    });

    var html = '<div class="cal-month-view">' +
      '<div class="cal-dow-row">' +
      DOW_SHORT.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      '</div><div class="cal-weeks">';

    var totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    var dayNum = 1;
    for (var cell = 0; cell < totalCells; cell++) {
      if (cell % 7 === 0) html += '<div class="cal-week">';
      if (cell < startDow) {
        /* previous-month overflow */
        html += '<div class="cal-day cal-day-other"><div class="cal-day-num cal-day-num-other">' +
                (prevLast - startDow + 1 + cell) + '</div></div>';
      } else if (dayNum <= daysInMonth) {
        var isToday   = today.year === year && today.month === month && today.day === dayNum;
        var evs       = byDay[dayNum] || [];
        var dn        = dayNum;
        html += '<div class="cal-day' + (isToday ? ' cal-today' : '') + (evs.length ? ' cal-has-events' : '') +
                '" onclick="calSetDay(' + year + ',' + month + ',' + dn + ')">' +
                '<div class="cal-day-num">' + dn + '</div>';
        if (evs.length) {
          html += '<div class="cal-day-events">';
          var shown = Math.min(evs.length, 3);
          for (var ei = 0; ei < shown; ei++) {
            var ev  = evs[ei];
            var s   = eventStart(ev);
            var tid = bbqThreadId(ev);
            var t   = s ? formatTime12(s.hour, s.minute) : '';
            html += '<div class="cal-event" onclick="event.stopPropagation();calEventClick(' +
                    JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
                    (t ? '<span class="cal-event-time">' + t + '</span> ' : '') +
                    '<span class="cal-event-name">' + escHtml(eventName(ev)) + '</span></div>';
          }
          if (evs.length > 3) {
            html += '<div class="cal-event-overflow">+' + (evs.length - 3) + ' more</div>';
          }
          html += '</div>';
        }
        html += '</div>';
        dayNum++;
      } else {
        /* next-month overflow */
        html += '<div class="cal-day cal-day-other"><div class="cal-day-num cal-day-num-other">' +
                (dayNum - daysInMonth) + '</div></div>';
        dayNum++;
      }
      if (cell % 7 === 6) html += '</div>';
    }
    html += '</div></div>';
    container.innerHTML = html;
    container.className = 'cal-month-wrap';
  }

  /* ── Week view ────────────────────────────────── */
  function renderWeek(container) {
    if (window.innerWidth <= MOBILE_BP) { renderWeekMobile(container); return; }

    var days  = getWeekDates(calDate);
    var today = todayChi();
    var first = days[0], last = days[6];
    var allEvs = eventsInRange(first, last);

    /* bucket events by day key */
    var byKey = {};
    days.forEach(function (d) { byKey[d.year + '-' + d.month + '-' + d.day] = []; });
    allEvs.forEach(function (ev) {
      var s = eventStart(ev);
      if (!s) return;
      var k = s.year + '-' + s.month + '-' + s.day;
      if (byKey[k]) byKey[k].push(ev);
    });

    var gridH = (DAY_END - DAY_START + 1) * HOUR_HEIGHT;

    var html = '<div class="cal-week-view">' +
      /* column headers */
      '<div class="cal-week-header">' +
      '<div class="cal-time-gutter-head"></div>';
    days.forEach(function (d) {
      var isT = sameDay(d, today);
      var dow = new Date(d.year, d.month, d.day).getDay();
      html += '<div class="cal-week-col-head' + (isT ? ' cal-col-today' : '') + '">' +
              '<div class="cal-week-dow">' + DOW_SHORT[dow] + '</div>' +
              '<div class="cal-week-date-num' + (isT ? ' cal-today-num' : '') + '">' + d.day + '</div>' +
              '</div>';
    });
    html += '</div>' +
      /* scrollable body */
      '<div class="cal-week-body" id="cal-week-scroll">' +
      '<div class="cal-time-gutter">';
    for (var h = DAY_START; h <= DAY_END; h++) {
      html += '<div class="cal-time-label">' + (h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM') + '</div>';
    }
    html += '</div>';

    days.forEach(function (d) {
      var isT = sameDay(d, today);
      var k   = d.year + '-' + d.month + '-' + d.day;
      var evs = byKey[k] || [];
      html += '<div class="cal-week-day-col' + (isT ? ' cal-today-col' : '') +
              '" style="height:' + gridH + 'px" onclick="calSetDay(' + d.year + ',' + d.month + ',' + d.day + ')">';
      /* hour lines */
      for (var hi = DAY_START; hi <= DAY_END; hi++) {
        html += '<div class="cal-hour-line"></div>';
      }
      /* events */
      evs.forEach(function (ev) {
        var s = eventStart(ev), e = eventEnd(ev);
        if (!s) return;
        var startMin = s.hour * 60 + s.minute;
        var endMin   = e ? (e.hour * 60 + e.minute) : startMin + 60;
        if (endMin <= startMin) endMin = startMin + 60;
        var topPx = (startMin - DAY_START * 60) / 60 * HOUR_HEIGHT;
        var htPx  = Math.max(24, (endMin - startMin) / 60 * HOUR_HEIGHT);
        var tid   = bbqThreadId(ev);
        html += '<div class="cal-timed-event" style="top:' + topPx + 'px;height:' + htPx + 'px"' +
                ' onclick="event.stopPropagation();calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
                '<div class="cal-timed-event-name">' + escHtml(eventName(ev)) + '</div>' +
                '<div class="cal-timed-event-time">' + formatTime12(s.hour, s.minute) + '</div>' +
                '</div>';
      });
      html += '</div>';
    });

    html += '</div></div>';
    container.innerHTML = html;
    container.className = 'cal-week-wrap';
    scrollToWorkday();
  }

  function renderWeekMobile(container) {
    var days  = getWeekDates(calDate);
    var today = todayChi();
    var first = days[0], last = days[6];
    var allEvs = eventsInRange(first, last);
    var byKey = {};
    allEvs.forEach(function (ev) {
      var s = eventStart(ev);
      if (!s) return;
      var k = s.year + '-' + s.month + '-' + s.day;
      (byKey[k] || (byKey[k] = [])).push(ev);
    });

    var html = '<div class="cal-week-mobile">';
    days.forEach(function (d) {
      var isT = sameDay(d, today);
      var k   = d.year + '-' + d.month + '-' + d.day;
      var evs = byKey[k] || [];
      var dow = new Date(d.year, d.month, d.day).getDay();
      html += '<div class="cal-mobile-day-row' + (isT ? ' cal-mobile-today-row' : '') +
              '" onclick="calSetDay(' + d.year + ',' + d.month + ',' + d.day + ')">' +
              '<div class="cal-mobile-day-label">' +
              '<span class="cal-mobile-dow">' + DOW_SHORT[dow] + '</span>' +
              '<span class="cal-mobile-day-num' + (isT ? ' cal-today-num' : '') + '">' + d.day + '</span>' +
              '</div>' +
              '<div class="cal-mobile-day-events">';
      if (evs.length === 0) {
        html += '<span class="cal-mobile-no-evs">—</span>';
      } else {
        evs.forEach(function (ev) {
          var s   = eventStart(ev);
          var tid = bbqThreadId(ev);
          var t   = s ? formatTime12(s.hour, s.minute) : '';
          html += '<div class="cal-mobile-event" onclick="event.stopPropagation();calEventClick(' +
                  JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
                  (t ? '<span class="cal-mobile-event-time">' + t + '</span>' : '') +
                  '<span class="cal-mobile-event-name">' + escHtml(eventName(ev)) + '</span>' +
                  '</div>';
        });
      }
      html += '</div></div>';
    });
    html += '</div>';
    container.innerHTML = html;
    container.className = 'cal-week-wrap';
  }

  /* ── Day view ─────────────────────────────────── */
  function renderDay(container) {
    var y = calDate.getFullYear(), m = calDate.getMonth(), d = calDate.getDate();
    var today = todayChi();
    var isToday = today.year === y && today.month === m && today.day === d;
    var evs = eventsInRange({year:y,month:m,day:d}, {year:y,month:m,day:d});
    var dateStr = y + '-' + pad2(m + 1) + '-' + pad2(d);
    var gridH = (DAY_END - DAY_START + 1) * HOUR_HEIGHT;

    var html = '<div class="cal-day-view">' +
      '<div class="cal-day-view-header">' +
      '<span class="cal-day-view-dow">' + DOW_FULL[new Date(y, m, d).getDay()] + '</span>' +
      '<span class="cal-day-view-date' + (isToday ? ' cal-today-date' : '') + '">' +
      MONTH_NAMES[m] + '\u00a0' + d + ', ' + y + '</span>' +
      '<button class="cal-add-btn-inline" onclick="window._calOpenNewEvent(\'' + dateStr + '\')">+ Event</button>' +
      '</div>' +
      '<div class="cal-day-body">' +
      '<div class="cal-time-gutter">';
    for (var h = DAY_START; h <= DAY_END; h++) {
      html += '<div class="cal-time-label">' + (h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM') + '</div>';
    }
    html += '</div>' +
      '<div class="cal-day-col" style="height:' + gridH + 'px">';
    for (var hi = DAY_START; hi <= DAY_END; hi++) {
      html += '<div class="cal-hour-line"></div>';
    }
    if (evs.length === 0) {
      html += '<div class="cal-day-empty-msg">No events today.</div>';
    }
    evs.forEach(function (ev) {
      var s = eventStart(ev), e = eventEnd(ev);
      if (!s) return;
      var startMin = s.hour * 60 + s.minute;
      var endMin   = e ? (e.hour * 60 + e.minute) : startMin + 60;
      if (endMin <= startMin) endMin = startMin + 60;
      var topPx = (startMin - DAY_START * 60) / 60 * HOUR_HEIGHT;
      var htPx  = Math.max(36, (endMin - startMin) / 60 * HOUR_HEIGHT);
      var tid   = bbqThreadId(ev);
      var eStr  = e ? formatTime12(e.hour, e.minute) : '';
      html += '<div class="cal-day-event" style="top:' + topPx + 'px;height:' + htPx + 'px"' +
              ' onclick="calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
              '<div class="cal-day-event-name">' + escHtml(eventName(ev)) + '</div>' +
              '<div class="cal-day-event-time">' + formatTime12(s.hour, s.minute) +
              (eStr ? '\u2009–\u2009' + eStr : '') + '</div>' +
              (ev.location ? '<div class="cal-day-event-loc">' + escHtml(ev.location) + '</div>' : '') +
              '</div>';
    });
    html += '</div></div></div>';
    container.innerHTML = html;
    container.className = 'cal-day-wrap';
    scrollToWorkday();
  }

  /* Scroll time-grid to 8 AM on first render */
  function scrollToWorkday() {
    setTimeout(function () {
      var el = document.getElementById('cal-week-scroll') ||
               document.querySelector('#cal-view-container .cal-day-body');
      if (el) el.scrollTop = (8 - DAY_START) * HOUR_HEIGHT;
    }, 0);
  }

  /* ── Event detail modal ──────────────────────── */
  function showEventModal(eventId) {
    var ev = null;
    Object.keys(calEventsCache).forEach(function (k) {
      calEventsCache[k].forEach(function (e) { if (e.id === eventId) ev = e; });
    });
    if (!ev) return;

    var s = eventStart(ev), e = eventEnd(ev);
    var t1 = s ? formatTime12(s.hour, s.minute) : '';
    var t2 = e ? formatTime12(e.hour, e.minute) : '';
    var timeRange = t1 ? t1 + (t2 && t2 !== t1 ? '\u2009–\u2009' + t2 : '') : 'All day';
    var tid  = bbqThreadId(ev);
    var desc = (ev.description || '').slice(0, 400);

    var modal = document.getElementById('cal-event-modal');
    if (!modal) return;

    document.getElementById('cal-em-title').textContent   = ev.summary || 'Catering Event';
    document.getElementById('cal-em-time').textContent    = timeRange;

    var locEl = document.getElementById('cal-em-loc');
    locEl.textContent    = ev.location || '';
    locEl.style.display  = ev.location ? '' : 'none';

    var descEl = document.getElementById('cal-em-desc');
    descEl.textContent   = desc;
    descEl.style.display = desc ? '' : 'none';

    var inqBtn = document.getElementById('cal-em-inq-btn');
    inqBtn.style.display = tid ? '' : 'none';
    inqBtn.onclick = function () { closeEventModal(); window._calOpenInquiry(tid); };

    var gcalLink = document.getElementById('cal-em-gcal-link');
    gcalLink.href         = ev.htmlLink || '#';
    gcalLink.style.display = ev.htmlLink ? '' : 'none';

    var delBtn = document.getElementById('cal-em-del-btn');
    delBtn.onclick = function () { closeEventModal(); deleteEvent(ev.id); };

    modal.style.display = 'flex';
  }

  function closeEventModal() {
    var modal = document.getElementById('cal-event-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ── New Event modal ─────────────────────────── */
  function openNewEventModal(dateStr) {
    var modal = document.getElementById('cal-new-event-modal');
    if (!modal) return;
    var di = document.getElementById('cal-ne-date');
    if (di) di.value = dateStr || '';
    modal.style.display = 'flex';
    var first = modal.querySelector('input, textarea');
    if (first) first.focus();
  }

  function closeNewEventModal() {
    var modal = document.getElementById('cal-new-event-modal');
    if (modal) modal.style.display = 'none';
    ['cal-ne-customer','cal-ne-guests','cal-ne-date','cal-ne-time',
     'cal-ne-address','cal-ne-duration','cal-ne-notes'].forEach(function (id) {
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
    if (!fields.eventDate) { if (errEl) errEl.textContent = 'Event date is required.'; return; }
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
      calEventsCache = {};
      await init();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Event'; }
    }
  }

  /* ── Delete ──────────────────────────────────── */
  async function deleteEvent(eventId) {
    if (!window.confirm('Delete this event from Google Calendar?')) return;
    try {
      var r = await fetch(
        '/api/calendar/delete?secret=' + encodeURIComponent(getSecret()) +
        '&eventId=' + encodeURIComponent(eventId),
        { method: 'DELETE' }
      );
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Delete failed');
      if (typeof window.showToast === 'function') window.showToast('Event deleted');
      calEventsCache = {};
      await init();
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message);
    }
  }

  /* ── Status helpers ──────────────────────────── */
  function setLoading(on) {
    var el = document.getElementById('cal-loading');
    if (el) el.style.display = on ? 'block' : 'none';
  }

  function setError(msg) {
    var el = document.getElementById('cal-error');
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  }

  /* ── Navigation ──────────────────────────────── */
  function prev() {
    if (calView === 'month') {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
    } else if (calView === 'week') {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() - 7);
    } else {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() - 1);
    }
    init();
  }

  function next() {
    if (calView === 'month') {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
    } else if (calView === 'week') {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() + 7);
    } else {
      calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() + 1);
    }
    init();
  }

  function goToday() {
    calDate = new Date();
    init();
  }

  function setView(v) {
    calView = v;
    init();
  }

  function setDay(year, month, day) {
    calDate = new Date(year, month, day);
    calView = 'day';
    init();
  }

  function calEventClick(eventId, threadId) {
    if (threadId && typeof openInquiry === 'function') {
      openInquiry(threadId);
    } else {
      showEventModal(eventId);
    }
  }

  /* ── Init / Refresh ──────────────────────────── */
  async function init() {
    setError('');
    setLoading(true);
    try {
      await ensureLoaded();
    } catch (e) {
      setError('Could not load calendar: ' + e.message);
    }
    setLoading(false);
    render();
  }

  async function refresh() {
    calEventsCache = {};
    await init();
  }

  /* ── Window bindings ─────────────────────────── */
  window.calInit           = init;
  window.calRefresh        = refresh;
  window.calPrev           = prev;
  window.calNext           = next;
  window.calToday          = goToday;
  window.calSetView        = setView;
  window.calSetDay         = setDay;
  window.calEventClick     = calEventClick;
  window.calOpenNewEvent   = openNewEventModal;
  window._calOpenNewEvent  = openNewEventModal;
  window._calCloseNewEvent = closeNewEventModal;
  window._calSubmitNewEvent = submitNewEvent;
  window._calEventClick    = calEventClick;
  window._calDeleteEvent   = deleteEvent;
  window._calOpenInquiry   = function (tid) { if (typeof openInquiry === 'function') openInquiry(tid); };
  window._calCloseEventModal = closeEventModal;

})();
