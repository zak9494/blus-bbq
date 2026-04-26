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
  /* calendar_v2 state */
  var calPeriod       = null;         // active period chip: null | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_year' | 'ytd' | 'custom'
  var calPeriodStart  = null;         // {year,month,day} — start of aggregate/custom range
  var calPeriodEnd    = null;         // {year,month,day} — end of aggregate/custom range
  var calTotalsOpen   = false;        // monthly totals dropdown visible
  var calInqStatusMap = {};           // threadId → inquiry status string (for color-coding)
  var calStatusFilters = new Set(['booked', 'completed']);
  var CAL_STATUS_FILTER_DEFS = [
    { key: 'needs_info',    label: 'Needs More Info', color: '#f59e0b' },
    { key: 'quote_drafted', label: 'Quote Drafted',   color: '#f59e0b' },
    { key: 'quote_sent',    label: 'Quote Sent',      color: '#3b82f6' },
    { key: 'booked',        label: 'Booked',          color: '#22c55e' },
    { key: 'completed',     label: 'Completed',       color: '#8b5cf6' },
  ];

  /* ── Status colors (calendar_v2) ─────────────── */
  var STATUS_COLORS = {
    new:            '#94a3b8',
    needs_info:     '#f59e0b',
    quote_drafted:  '#f59e0b',
    quote_approved: '#3b82f6',
    quote_sent:     '#3b82f6',
    booked:         '#22c55e',
    declined:       '#ef4444',
    completed:      '#8b5cf6',
    archived:       '#9ca3af',
    '__default__':  '#f59e0b',
  };
  var STATUS_ORDER  = ['booked','quote_sent','quote_approved','quote_drafted','needs_info','new','completed','declined','archived'];
  var STATUS_LABELS = {
    new: 'New', needs_info: 'Needs Info', quote_drafted: 'Quote Drafted',
    quote_approved: 'Approved', quote_sent: 'Quote Sent',
    booked: 'Booked', declined: 'Declined', completed: 'Completed', archived: 'Archived',
  };

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
    var hasTime = m[4] !== undefined;
    return { year: +m[1], month: +m[2] - 1, day: +m[3],
             hour: hasTime ? +m[4] : 0,
             minute: m[5] !== undefined ? +m[5] : 0,
             hasTime: hasTime };
  }

  function eventStart(ev) { return parseCalDT(ev.start && (ev.start.dateTime || ev.start.date)); }
  function eventEnd(ev)   { return parseCalDT(ev.end   && (ev.end.dateTime   || ev.end.date));   }

  function formatTime12(h, min) {
    var ampm = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + pad2(min) + '\u202f' + ampm;
  }

  /* Time chip for a calendar event chip/list item.
     - real time present  \u2192 "6:00 PM"
     - BBQ-managed event with no time (synthetic from inquiry, or BBQ-tagged
       gcal event) \u2192 "TBD"
     - non-BBQ Google all-day event \u2192 "" (caller falls through to no chip)
     A real midnight booking has dateTime "\u2026T00:00:00\u2026" \u2192 hasTime=true \u2192 shown
     as "12:00 AM". Synthetic all-day items use start.date and have hasTime=false. */
  function formatStartTime(ev) {
    var s = eventStart(ev);
    if (s && s.hasTime) return formatTime12(s.hour, s.minute);
    if (ev && (ev.bbqVirtual || bbqThreadId(ev))) return 'TBD';
    return '';
  }

  function formatEndTime(ev) {
    var e = eventEnd(ev);
    if (e && e.hasTime) return formatTime12(e.hour, e.minute);
    return '';
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

  /* calendar_v2 helpers */
  function isPastEvent(ev) {
    var s = eventStart(ev);
    if (!s) return false;
    var t = todayChi();
    return (s.year * 10000 + s.month * 100 + s.day) < (t.year * 10000 + t.month * 100 + t.day);
  }

  function eventStatusColor(ev) {
    var tid = bbqThreadId(ev);
    var st = (tid && calInqStatusMap[tid]) || '__default__';
    return STATUS_COLORS[st] || STATUS_COLORS['__default__'];
  }

  function computePeriodRange(period) {
    var t = todayChi();
    if (period === 'last_year') {
      return { start: { year: t.year - 1, month: 0, day: 1 }, end: { year: t.year - 1, month: 11, day: 31 } };
    }
    if (period === 'ytd') {
      return { start: { year: t.year, month: 0, day: 1 }, end: t };
    }
    return null;
  }

  async function loadInqStatuses() {
    var threadIds = [];
    Object.keys(calEventsCache).forEach(function (k) {
      calEventsCache[k].forEach(function (ev) {
        var tid = bbqThreadId(ev);
        if (tid && threadIds.indexOf(tid) === -1) threadIds.push(tid);
      });
    });
    if (!threadIds.length) return;
    await Promise.all(threadIds.map(async function (tid) {
      try {
        var r = await fetch('/api/inquiries/get?threadId=' + encodeURIComponent(tid) + '&secret=' + encodeURIComponent(getSecret()));
        if (!r.ok) return;
        var d = await r.json();
        if (d.inquiry && d.inquiry.status) calInqStatusMap[tid] = d.inquiry.status;
      } catch {}
    }));
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
  function eventPassesStatusFilter(ev) {
    if (!(window.flags && typeof window.flags.isEnabled === 'function' && window.flags.isEnabled('calendar_filters_v2'))) return true;
    var tid = bbqThreadId(ev);
    var status = (tid && calInqStatusMap[tid]) || '';
    if (!status) return true;
    return calStatusFilters.has(status);
  }

  function toggleStatusFilter(key) {
    if (calStatusFilters.has(key)) {
      if (calStatusFilters.size > 1) calStatusFilters.delete(key);
    } else {
      calStatusFilters.add(key);
    }
    render();
  }

  function renderCalStatusChips() {
    var bar = document.getElementById('cal-status-chips-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cal-status-chips-bar';
      bar.className = 'cal-status-chips-row';
      var calPage = document.getElementById('page-calendar');
      var hdr = calPage && calPage.querySelector('.cal-header');
      if (hdr && hdr.nextSibling) {
        hdr.parentNode.insertBefore(bar, hdr.nextSibling);
      } else if (calPage) {
        calPage.insertBefore(bar, calPage.firstChild);
      }
    }
    bar.innerHTML = '';
    CAL_STATUS_FILTER_DEFS.forEach(function (def) {
      var btn = document.createElement('button');
      btn.className = 'cal-status-chip' + (calStatusFilters.has(def.key) ? ' cal-status-chip-active' : '');
      btn.textContent = def.label;
      if (calStatusFilters.has(def.key)) btn.style.borderColor = def.color;
      btn.onclick = function () { toggleStatusFilter(def.key); };
      bar.appendChild(btn);
    });
  }

  function render() {
    updateHeader();
    updateViewButtons();
    var container = document.getElementById('cal-view-container');
    if (!container) return;
    if (calView === 'month')      renderMonth(container);
    else if (calView === 'week')  renderWeek(container);
    else                          renderDay(container);
    if (window.flags && typeof window.flags.isEnabled === 'function' && window.flags.isEnabled('calendar_filters_v2')) {
      renderCalStatusChips();
    } else {
      renderPeriodChips();
      renderTotalsBtn();
    }
    if (window.flags && window.flags.isEnabled('calendar_v2')) renderLegend();
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
      if (!eventPassesStatusFilter(ev)) return;
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
            var tid = bbqThreadId(ev);
            var t   = formatStartTime(ev);
            html += '<div class="cal-event' + (ev.hidden ? ' cal-event-hidden' : '') + '" onclick="event.stopPropagation();calEventClick(' +
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
        var tEv = formatStartTime(ev);
        html += '<div class="cal-timed-event' + (ev.hidden ? ' cal-event-hidden' : '') + '" style="top:' + topPx + 'px;height:' + htPx + 'px"' +
                ' onclick="event.stopPropagation();calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
                '<div class="cal-timed-event-name">' + escHtml(eventName(ev)) + '</div>' +
                (tEv ? '<div class="cal-timed-event-time">' + tEv + '</div>' : '') +
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
      if (!eventPassesStatusFilter(ev)) return;
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
          var tid = bbqThreadId(ev);
          var t   = formatStartTime(ev);
          html += '<div class="cal-mobile-event' + (ev.hidden ? ' cal-event-hidden' : '') + '" onclick="event.stopPropagation();calEventClick(' +
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
    var evs = eventsInRange({year:y,month:m,day:d}, {year:y,month:m,day:d}).filter(eventPassesStatusFilter);
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
      var sStr  = formatStartTime(ev);
      var eStr  = formatEndTime(ev);
      var timeText = sStr ? sStr + (eStr && eStr !== sStr ? '\u2009–\u2009' + eStr : '') : '';
      html += '<div class="cal-day-event' + (ev.hidden ? ' cal-event-hidden' : '') + '" style="top:' + topPx + 'px;height:' + htPx + 'px"' +
              ' onclick="calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
              '<div class="cal-day-event-name">' + escHtml(eventName(ev)) + '</div>' +
              (timeText ? '<div class="cal-day-event-time">' + timeText + '</div>' : '') +
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

    var t1 = formatStartTime(ev);
    var t2 = formatEndTime(ev);
    /* "TBD" indicates a BBQ-managed event with no time. "All day" is reserved for
       native Google Calendar all-day events that we don't manage. */
    var timeRange = t1 ? t1 + (t2 && t2 !== t1 ? '\u2009–\u2009' + t2 : '') : 'All day';
    var tid  = bbqThreadId(ev);
    var desc = (ev.description || '').slice(0, 400);

    var modal = document.getElementById('cal-event-modal');
    if (!modal) return;

    document.getElementById('cal-em-title').textContent   = ev.summary || 'Catering Event';
    document.getElementById('cal-em-time').textContent    = timeRange;

    var locEl = document.getElementById('cal-em-loc');
    locEl.style.display = ev.location ? '' : 'none';
    if (ev.location) {
      var mapsEnabled = window.flags && window.flags.isEnabled('maps_v1');
      if (mapsEnabled) {
        var staticGmUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ev.location);
        var gmUrl = window.mapboxDistance ? window.mapboxDistance.mapsViewUrl(ev.location) : staticGmUrl;
        locEl.innerHTML = '<div class="cal-em-loc-row">'
          + '<span class="cal-em-loc-text">' + escHtml(ev.location) + '</span>'
          + '<a class="maps-view-btn" id="cal-em-view-map" href="' + escHtml(gmUrl || '#') + '" target="_blank" rel="noopener">View Map</a>'
          + (window.mapboxDistance ? '<span class="maps-dist-chip maps-loading" id="cal-em-dist-chip">\u2026</span>' : '')
          + '</div>';
        if (window.mapboxDistance) {
          var departAt = (ev.start && ev.start.dateTime) ? ev.start.dateTime : null;
          window.mapboxDistance.fetch('default', ev.location, departAt)
            .then(function (result) {
              var chip = document.getElementById('cal-em-dist-chip');
              if (!chip) return;
              if (result && result.ok) {
                chip.textContent = window.mapboxDistance.fmtChip(result);
                chip.classList.remove('maps-loading');
                chip.title = 'Free-flow: ' + result.freeFlowMin + ' min \u00b7 With traffic: ' + result.trafficMin + ' min';
                var btn = document.getElementById('cal-em-view-map');
                if (btn) btn.href = window.mapboxDistance.mapsViewUrl(ev.location);
              } else if (result && result.error === 'no_origin_address') {
                var btn2 = document.getElementById('cal-em-view-map');
                if (btn2) btn2.remove();
                var notice = document.createElement('span');
                notice.className = 'maps-empty-notice';
                notice.setAttribute('data-testid', 'maps-empty-notice');
                notice.innerHTML = 'Set your shop address in '
                  + '<a href="#" class="maps-empty-link" onclick="window._calCloseEventModal&amp;&amp;window._calCloseEventModal();window.openShopAddressSetting&amp;&amp;window.openShopAddressSetting();return false;">Settings &rarr; Shop Info</a>'
                  + ' to enable maps &amp; drive times.';
                chip.replaceWith(notice);
              } else {
                chip.style.display = 'none';
              }
            });
        }
      } else {
        locEl.textContent = ev.location;
      }
    }

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
  async function deleteEvent(eventId, opts) {
    opts = opts || {};
    try {
      var r = await fetch(
        '/api/calendar/delete?secret=' + encodeURIComponent(getSecret()) +
        '&eventId=' + encodeURIComponent(eventId),
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }
      );
      var d = await r.json();

      if (r.status === 403) {
        /* Past event — offer soft-delete (hide with strikethrough, preserved for records) */
        if (window.BottomSheet) {
          window.BottomSheet.open({
            title: 'Past Event',
            body: 'Past events are preserved for records and cannot be permanently deleted.',
            actions: [
              { label: 'Hide on Calendar', style: 'danger', onClick: function () { deleteEvent(eventId, { soft: true }); } },
              { label: 'Keep Event',       style: 'cancel' },
            ],
          });
        } else if (window.confirm('Past events cannot be deleted (they are preserved for records).\n\nHide it on the calendar instead? It will appear struck through.')) {
          return deleteEvent(eventId, { soft: true });
        }
        return;
      }

      if (d.requiresConfirmation) {
        if (window.BottomSheet) {
          window.BottomSheet.open({
            title: 'Delete Event',
            body: 'Remove this event from Google Calendar? This cannot be undone.',
            actions: [
              { label: 'Delete',  style: 'danger',  onClick: function () { deleteEvent(eventId, { confirmed: true }); } },
              { label: 'Cancel',  style: 'cancel' },
            ],
          });
        } else if (!window.confirm('Delete this event from Google Calendar?')) {
          return;
        } else {
          return deleteEvent(eventId, { confirmed: true });
        }
        return;
      }

      if (!d.ok) throw new Error(d.error || 'Delete failed');
      if (typeof window.showToast === 'function') {
        window.showToast(d.hidden ? 'Event hidden (preserved for records)' : 'Event deleted');
      }
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
  /* Sync CSS sticky offsets to actual topbar height each time calendar opens */
  function syncStickyOffsets() {
    var calPage = document.getElementById('page-calendar');
    var tb = calPage && calPage.querySelector('.topbar');
    if (!tb) return;
    var h = tb.offsetHeight;
    if (!h) return;
    document.documentElement.style.setProperty('--cal-topbar-h', h + 'px');
    document.documentElement.style.setProperty('--cal-header-top', h + 'px');
    requestAnimationFrame(function () {
      var ch = calPage.querySelector('.cal-header');
      if (ch && ch.offsetHeight) {
        document.documentElement.style.setProperty('--cal-header-h', ch.offsetHeight + 'px');
      }
    });
  }

  async function init() {
    syncStickyOffsets();
    setError('');
    setLoading(true);
    try {
      await ensureLoaded();
      if (window.flags && (window.flags.isEnabled('calendar_v2') || window.flags.isEnabled('calendar_filters_v2'))) {
        await loadInqStatuses();
      }
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

  /* ── Agenda view (calendar_v2: last_year / ytd / custom) ─── */
  function renderAgenda(container) {
    if (!calPeriodStart || !calPeriodEnd) {
      container.innerHTML = '<div class="cal-agenda-empty">No period selected.</div>';
      container.className = '';
      return;
    }
    var evs = eventsInRange(calPeriodStart, calPeriodEnd);
    if (evs.length === 0) {
      container.innerHTML = '<div class="cal-agenda-empty">No events in this period.</div>';
      container.className = '';
      return;
    }
    /* group by YYYY-M key (sort order preserved by month-key sort) */
    var groups = {};
    evs.forEach(function (ev) {
      var s = eventStart(ev);
      if (!s) return;
      var k = s.year + '-' + pad2(s.month);
      if (!groups[k]) groups[k] = { year: s.year, month: s.month, evs: [] };
      groups[k].evs.push(ev);
    });
    var html = '<div class="cal-agenda-view">';
    Object.keys(groups).sort().forEach(function (k) {
      var g = groups[k];
      html += '<div class="cal-agenda-month-group">' +
              '<div class="cal-agenda-month-label">' + MONTH_NAMES[g.month] + '\u00a0' + g.year + '</div>';
      g.evs.forEach(function (ev) {
        var s = eventStart(ev);
        if (!s) return;
        var t1  = formatStartTime(ev);
        var t2  = formatEndTime(ev);
        var tid = bbqThreadId(ev);
        var clr = eventStatusColor(ev);
        html += '<div class="cal-agenda-event' + (ev.hidden ? ' cal-event-hidden' : '') + '" style="border-left-color:' + clr + '"' +
                ' onclick="calEventClick(' + JSON.stringify(ev.id) + ',' + JSON.stringify(tid) + ')">' +
                '<div class="cal-agenda-event-date">' +
                '<span class="cal-agenda-dow">' + DOW_SHORT[new Date(s.year, s.month, s.day).getDay()] + '</span>' +
                '<span class="cal-agenda-day">' + s.day + '</span>' +
                '</div>' +
                '<div class="cal-agenda-event-info">' +
                '<div class="cal-agenda-event-name">' + escHtml(eventName(ev)) + '</div>' +
                (t1 ? '<div class="cal-agenda-event-time">' + t1 + (t2 && t2 !== t1 ? '\u2009–\u2009' + t2 : '') + '</div>' : '') +
                '</div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
    container.className = '';
  }

  /* ── Status legend (calendar_v2) ─────────────────── */
  function renderLegend() {
    var id = 'cal-v2-legend';
    var existing = document.getElementById(id);
    /* collect which statuses are in the current view */
    var seen = {};
    Object.keys(calEventsCache).forEach(function (k) {
      calEventsCache[k].forEach(function (ev) {
        var tid = bbqThreadId(ev);
        var st  = (tid && calInqStatusMap[tid]) || '__default__';
        seen[st] = true;
      });
    });
    var items = STATUS_ORDER.filter(function (s) { return seen[s]; });
    if (seen['__default__']) items.push('__default__');

    var html = '<div id="' + id + '" class="cal-v2-legend">';
    STATUS_ORDER.forEach(function (st) {
      if (!seen[st]) return;
      html += '<span class="cal-legend-item">' +
              '<span class="cal-legend-dot" style="background:' + STATUS_COLORS[st] + '"></span>' +
              escHtml(STATUS_LABELS[st] || st) + '</span>';
    });
    if (seen['__default__']) {
      html += '<span class="cal-legend-item">' +
              '<span class="cal-legend-dot" style="background:#f59e0b"></span>Unlinked</span>';
    }
    html += '</div>';

    if (existing) {
      existing.outerHTML = html;
    } else {
      var viewContainer = document.getElementById('cal-view-container');
      if (viewContainer) viewContainer.insertAdjacentHTML('beforebegin', html);
    }
  }

  /* ── Period selector chips (calendar_v2) ─────────── */
  var PERIOD_LABELS = {
    this_week:  'This Week',
    last_week:  'Last Week',
    this_month: 'This Month',
    last_month: 'Last Month',
    last_year:  'Last Year',
    ytd:        'YTD',
    custom:     'Custom\u2026',
  };
  var PERIOD_ORDER = ['this_week','last_week','this_month','last_month','last_year','ytd','custom'];

  function renderPeriodChips() {
    var rowId = 'cal-period-chips-row';
    var existing = document.getElementById(rowId);
    var html = '<div id="' + rowId + '" class="cal-period-chips-row">';
    PERIOD_ORDER.forEach(function (p) {
      var active = calPeriod === p;
      html += '<button class="cal-period-chip' + (active ? ' cal-period-chip-active' : '') + '"' +
              ' onclick="calSetPeriod(' + JSON.stringify(p) + ')">' +
              PERIOD_LABELS[p] + '</button>';
    });
    /* Custom range inputs — shown when calPeriod === 'custom' */
    if (calPeriod === 'custom') {
      var startVal = calPeriodStart ? (calPeriodStart.year + '-' + pad2(calPeriodStart.month + 1) + '-' + pad2(calPeriodStart.day)) : '';
      var endVal   = calPeriodEnd   ? (calPeriodEnd.year   + '-' + pad2(calPeriodEnd.month   + 1) + '-' + pad2(calPeriodEnd.day))   : '';
      html += '<input id="cal-custom-start" class="cal-custom-date" type="date" value="' + startVal + '" placeholder="Start"' +
              ' onchange="calApplyCustomRange()">' +
              '<span class="cal-custom-sep">–</span>' +
              '<input id="cal-custom-end" class="cal-custom-date" type="date" value="' + endVal + '" placeholder="End"' +
              ' onchange="calApplyCustomRange()">';
    }
    html += '</div>';

    if (existing) {
      existing.outerHTML = html;
    } else {
      var calHeader = document.querySelector('#page-calendar .cal-header');
      if (calHeader) calHeader.insertAdjacentHTML('afterend', html);
    }
  }

  /* Apply the custom date range from the two date inputs */
  function applyCustomRange() {
    var s = document.getElementById('cal-custom-start');
    var e = document.getElementById('cal-custom-end');
    if (!s || !e || !s.value || !e.value) return;
    var sp = s.value.split('-'), ep = e.value.split('-');
    calPeriodStart = { year: +sp[0], month: +sp[1] - 1, day: +sp[2] };
    calPeriodEnd   = { year: +ep[0], month: +ep[1] - 1, day: +ep[2] };
    calPeriod = 'custom';
    init();
  }

  /* ── Monthly totals button (calendar_v2, month view only) ── */
  function renderTotalsBtn() {
    var btnId = 'cal-totals-btn';
    var existing = document.getElementById(btnId);
    /* Only show in regular month view */
    var showIt = calView === 'month' && !calPeriod;
    if (!showIt) {
      if (existing) existing.remove();
      var dd = document.getElementById('cal-totals-dd');
      if (dd) dd.remove();
      calTotalsOpen = false;
      return;
    }
    if (!existing) {
      var header = document.querySelector('#page-calendar .cal-header');
      if (!header) return;
      var btn = document.createElement('button');
      btn.id        = btnId;
      btn.className = 'cal-totals-btn';
      btn.onclick   = function () { toggleTotals(); };
      header.appendChild(btn);
      existing = btn;
    }
    /* Calculate totals from current month's events */
    var year = calDate.getFullYear(), month = calDate.getMonth();
    var evs = calEventsCache[year + '-' + month] || [];
    var total = 0, count = 0;
    evs.forEach(function (ev) {
      var m = (ev.description || '').match(/Quote Total:\s*\$?([\d,]+\.?\d*)/i);
      if (m) { total += parseFloat(m[1].replace(/,/g, '')); count++; }
    });
    var fmt = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    existing.textContent = count > 0 ? fmt : '$ Totals';
    if (calTotalsOpen) renderTotalsDropdown(existing, evs);
  }

  function toggleTotals() {
    calTotalsOpen = !calTotalsOpen;
    var dd = document.getElementById('cal-totals-dd');
    if (!calTotalsOpen) { if (dd) dd.remove(); return; }
    var btn = document.getElementById('cal-totals-btn');
    var year = calDate.getFullYear(), month = calDate.getMonth();
    var evs = calEventsCache[year + '-' + month] || [];
    renderTotalsDropdown(btn, evs);
  }

  function renderTotalsDropdown(anchorBtn, evs) {
    var ddId = 'cal-totals-dd';
    var existing = document.getElementById(ddId);
    if (existing) existing.remove();

    var total = 0, bookCount = 0;
    var rows = [];
    evs.forEach(function (ev) {
      var m = (ev.description || '').match(/Quote Total:\s*\$?([\d,]+\.?\d*)/i);
      var amt = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
      var tid = bbqThreadId(ev);
      var st  = (tid && calInqStatusMap[tid]) || '';
      if (amt > 0) { total += amt; bookCount++; }
      rows.push({ name: eventName(ev), amt: amt, status: st });
    });

    var fmtAmt = function (n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
    var html = '<div id="' + ddId + '" class="cal-totals-dd">' +
               '<div class="cal-totals-dd-header">' + MONTH_NAMES[calDate.getMonth()] + ' ' + calDate.getFullYear() + '</div>' +
               '<div class="cal-totals-dd-total">Total: <strong>' + fmtAmt(total) + '</strong></div>' +
               '<div class="cal-totals-dd-sub">' + evs.length + ' event' + (evs.length !== 1 ? 's' : '') +
               (bookCount > 0 ? ', ' + bookCount + ' with quotes' : '') + '</div>';
    if (rows.length > 0) {
      html += '<div class="cal-totals-dd-rows">';
      rows.forEach(function (row) {
        var clr = (row.status && STATUS_COLORS[row.status]) || '#f59e0b';
        html += '<div class="cal-totals-dd-row">' +
                '<span class="cal-totals-dot" style="background:' + clr + '"></span>' +
                '<span class="cal-totals-name">' + escHtml(row.name) + '</span>' +
                (row.amt > 0 ? '<span class="cal-totals-amt">' + fmtAmt(row.amt) + '</span>' : '') +
                '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    var dd = document.getElementById(ddId);
    /* position below the button */
    var rect = anchorBtn.getBoundingClientRect();
    dd.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    dd.style.left = Math.max(8, rect.left + window.scrollX - dd.offsetWidth + rect.width) + 'px';

    /* close on outside click */
    setTimeout(function () {
      document.addEventListener('click', function closer(ev) {
        if (!dd.contains(ev.target) && ev.target !== anchorBtn) {
          calTotalsOpen = false;
          dd.remove();
          document.removeEventListener('click', closer);
        }
      });
    }, 0);
  }

  /* ── Period navigation (calendar_v2) ─────────────── */
  function setPeriod(period) {
    var t = todayChi();
    calTotalsOpen = false;
    /* Remove totals dropdown if open */
    var dd = document.getElementById('cal-totals-dd');
    if (dd) dd.remove();

    if (period === 'this_week') {
      calPeriod = null;
      calDate = new Date(t.year, t.month, t.day);
      calView = 'week';
      init();
      return;
    }
    if (period === 'last_week') {
      calPeriod = null;
      calDate = new Date(t.year, t.month, t.day - 7);
      calView = 'week';
      init();
      return;
    }
    if (period === 'this_month') {
      calPeriod = null;
      calDate = new Date(t.year, t.month, 1);
      calView = 'month';
      init();
      return;
    }
    if (period === 'last_month') {
      calPeriod = null;
      calDate = new Date(t.year, t.month - 1, 1);
      calView = 'month';
      init();
      return;
    }
    if (period === 'custom') {
      calPeriod = 'custom';
      /* Keep existing range or default to current month */
      if (!calPeriodStart) {
        calPeriodStart = { year: t.year, month: t.month, day: 1 };
        calPeriodEnd   = { year: t.year, month: t.month, day: new Date(t.year, t.month + 1, 0).getDate() };
      }
      render(); /* just re-render to show the custom date inputs */
      return;
    }
    /* last_year, ytd → agenda view */
    var range = computePeriodRange(period);
    if (range) {
      calPeriod      = period;
      calPeriodStart = range.start;
      calPeriodEnd   = range.end;
      init();
    }
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
  window._calOpenInquiry     = function (tid) { if (typeof openInquiry === 'function') openInquiry(tid); };
  window._calCloseEventModal = closeEventModal;
  window.calSetPeriod        = setPeriod;
  window.calApplyCustomRange = applyCustomRange;
  window.calIsPastEvent         = isPastEvent;
  window.calToggleStatusFilter = toggleStatusFilter;

})();
