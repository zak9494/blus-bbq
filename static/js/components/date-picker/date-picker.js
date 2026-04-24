/* ===== MODULE: DatePickerV2 — Unified date-range picker component
   File: static/js/components/date-picker/date-picker.js
   Exposes: window.DatePickerV2 = { create, computeRange }
   ===== */
(function () {
  'use strict';

  var MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
  var DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  var PRESET_DEFS = {
    today:       { label: 'Today' },
    yesterday:   { label: 'Yesterday' },
    this_week:   { label: 'This week' },
    last_week:   { label: 'Last week' },
    last_7_days: { label: 'Last 7 days' },
    this_month:  { label: 'This month' },
    last_month:  { label: 'Last month' },
    custom:      { label: 'Custom range' },
  };

  function startOf(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function computeRange(preset, pivot) {
    var p = pivot ? startOf(pivot) : startOf(new Date());
    var s, e;
    if (preset === 'today') {
      s = p; e = p;
    } else if (preset === 'yesterday') {
      s = new Date(p); s.setDate(p.getDate() - 1); e = new Date(s);
    } else if (preset === 'this_week') {
      var dow = p.getDay();
      s = new Date(p); s.setDate(p.getDate() - ((dow + 6) % 7));
      e = new Date(s); e.setDate(s.getDate() + 6);
    } else if (preset === 'last_week') {
      var dow2 = p.getDay();
      var mon = new Date(p); mon.setDate(p.getDate() - ((dow2 + 6) % 7));
      s = new Date(mon); s.setDate(mon.getDate() - 7);
      e = new Date(mon); e.setDate(mon.getDate() - 1);
    } else if (preset === 'last_7_days') {
      s = new Date(p); s.setDate(p.getDate() - 6); e = p;
    } else if (preset === 'this_month') {
      s = new Date(p.getFullYear(), p.getMonth(), 1);
      e = new Date(p.getFullYear(), p.getMonth() + 1, 0);
    } else if (preset === 'last_month') {
      s = new Date(p.getFullYear(), p.getMonth() - 1, 1);
      e = new Date(p.getFullYear(), p.getMonth(), 0);
    } else {
      s = null; e = null;
    }
    return { start: s, end: e };
  }

  function stepPivot(preset, pivot, dir) {
    var p = pivot ? startOf(pivot) : startOf(new Date());
    var n = new Date(p);
    if (preset === 'today' || preset === 'yesterday') {
      n.setDate(p.getDate() + dir);
    } else if (preset === 'this_week' || preset === 'last_week' || preset === 'last_7_days') {
      n.setDate(p.getDate() + dir * 7);
    } else {
      n.setMonth(p.getMonth() + dir);
    }
    return n;
  }

  function fmt(d) {
    if (!d) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseLocalDate(str) {
    if (!str) return null;
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function create(opts) {
    opts = opts || {};
    var container   = opts.container;
    var presets     = opts.presets || Object.keys(PRESET_DEFS);
    var noPastDates = !!opts.noPastDates;
    var onChange    = opts.onChange || function () {};
    var initPreset  = opts.initialPreset || presets[0] || 'this_month';

    var _preset    = initPreset;
    var _pivot     = new Date();
    var _customS   = null;
    var _customE   = null;
    var _selecting = false; // true = first click done, waiting for end
    var _triggerEl = null;
    var _popover   = null;
    var _mounted   = false;

    function _getRange() {
      if (_preset === 'custom') return { start: _customS, end: _customE };
      return computeRange(_preset, _pivot);
    }

    function _label() {
      if (_preset === 'custom') {
        if (_customS && _customE) return fmt(_customS) + ' – ' + fmt(_customE);
        if (_customS) return fmt(_customS) + ' –';
        return 'Custom range';
      }
      var def = PRESET_DEFS[_preset];
      return def ? def.label : _preset;
    }

    function _updateTrigger() {
      if (!_triggerEl) return;
      var lbl = _triggerEl.querySelector('.dp-label');
      if (lbl) lbl.textContent = _label();
    }

    function _emit() {
      _updateTrigger();
      onChange(_getRange());
    }

    function _buildCalGrid(year, month) {
      var today = startOf(new Date());
      var range = _getRange();
      var rs = range.start ? startOf(range.start) : null;
      var re = range.end   ? startOf(range.end)   : null;

      var html = '<div class="dp-cal-grid">';
      html += '<div class="dp-cal-header"><button class="dp-cal-nav dp-cal-prev" data-y="' + year + '" data-m="' + month + '" data-dir="-1">‹</button>'
            + '<span class="dp-cal-title">' + MONTH_NAMES[month] + ' ' + year + '</span>'
            + '<button class="dp-cal-nav dp-cal-next" data-y="' + year + '" data-m="' + month + '" data-dir="1">›</button></div>';
      html += '<div class="dp-dow-row">' + DOW.map(function (d) { return '<div class="dp-dow">' + d + '</div>'; }).join('') + '</div>';

      var firstDow = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      html += '<div class="dp-days">';
      for (var i = 0; i < firstDow; i++) html += '<div class="dp-day dp-day-empty"></div>';
      for (var d = 1; d <= daysInMonth; d++) {
        var thisDay = new Date(year, month, d);
        var isPast  = noPastDates && thisDay < today;
        var isToday = thisDay.getTime() === today.getTime();
        var inRange = rs && re && thisDay >= rs && thisDay <= re;
        var isStart = rs && thisDay.getTime() === rs.getTime();
        var isEnd   = re && thisDay.getTime() === re.getTime();
        var cls = 'dp-day';
        if (isPast)   cls += ' dp-day-past';
        if (isToday)  cls += ' dp-day-today';
        if (inRange)  cls += ' dp-day-in-range';
        if (isStart)  cls += ' dp-day-start';
        if (isEnd)    cls += ' dp-day-end';
        var dateAttr = isPast ? '' : ' data-date="' + isoDate(thisDay) + '"';
        html += '<div class="' + cls + '"' + dateAttr + '>' + d + '</div>';
      }
      html += '</div>';
      html += '</div>';
      return html;
    }

    function _buildPopover() {
      var range = _getRange();
      var html = '<div class="dp-popover">';

      // Preset sidebar
      html += '<div class="dp-sidebar">';
      presets.forEach(function (key) {
        var def = PRESET_DEFS[key];
        if (!def) return;
        var act = _preset === key;
        html += '<button class="dp-preset-btn' + (act ? ' dp-preset-active' : '') + '" data-preset="' + key + '">' + def.label + '</button>';
      });
      html += '</div>';

      // Calendar section
      html += '<div class="dp-cal-section">';

      if (_preset === 'custom') {
        // Two-month calendar for custom range
        var now = new Date();
        var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        html += '<div class="dp-two-months">';
        html += _buildCalGrid(lm.getFullYear(), lm.getMonth());
        html += _buildCalGrid(now.getFullYear(), now.getMonth());
        html += '</div>';
        // Custom date text inputs
        html += '<div class="dp-custom-inputs">'
          + '<input class="dp-custom-input" id="dp-custom-start" placeholder="Start (MM/DD/YYYY)" value="' + (range.start ? fmt(range.start) : '') + '">'
          + '<span class="dp-custom-sep">–</span>'
          + '<input class="dp-custom-input" id="dp-custom-end" placeholder="End (MM/DD/YYYY)" value="' + (range.end ? fmt(range.end) : '') + '">'
          + '<button class="dp-apply-btn" id="dp-custom-apply">Apply</button>'
          + '</div>';
      } else {
        // Single pivot calendar
        html += _buildCalGrid(_pivot.getFullYear(), _pivot.getMonth());
      }

      html += '</div>';
      html += '</div>';
      return html;
    }

    function _renderPopover() {
      if (!_popover) return;
      _popover.innerHTML = _buildPopover();
      _bindPopoverEvents();
    }

    function _bindPopoverEvents() {
      if (!_popover) return;

      // Preset buttons
      _popover.querySelectorAll('[data-preset]').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          _preset = btn.dataset.preset;
          if (_preset !== 'custom') { _pivot = new Date(); _emit(); }
          _renderPopover();
        };
      });

      // Calendar day clicks
      _popover.querySelectorAll('[data-date]').forEach(function (el) {
        el.onclick = function (e) {
          e.stopPropagation();
          var d = parseLocalDate(el.dataset.date);
          if (!d) return;
          if (_preset === 'custom') {
            if (!_selecting) {
              _customS = d; _customE = null; _selecting = true;
            } else {
              if (d < _customS) { _customE = _customS; _customS = d; }
              else              { _customE = d; }
              _selecting = false;
              _emit();
            }
            _renderPopover();
          } else {
            _pivot = d; _emit(); _renderPopover();
          }
        };
      });

      // Cal nav (prev/next month for custom two-month view)
      _popover.querySelectorAll('.dp-cal-nav').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var y = +btn.dataset.y, m = +btn.dataset.m, dir = +btn.dataset.dir;
          _pivot = new Date(y, m + dir, 1);
          _renderPopover();
        };
      });

      // Custom apply button
      var applyBtn = _popover.querySelector('#dp-custom-apply');
      if (applyBtn) {
        applyBtn.onclick = function (e) {
          e.stopPropagation();
          var sIn = document.getElementById('dp-custom-start');
          var eIn = document.getElementById('dp-custom-end');
          var sv = sIn ? sIn.value.trim() : '';
          var ev = eIn ? eIn.value.trim() : '';
          var sd = sv ? new Date(sv) : null;
          var ed = ev ? new Date(ev) : null;
          if (sd && !isNaN(sd.getTime())) _customS = startOf(sd);
          if (ed && !isNaN(ed.getTime())) _customE = startOf(ed);
          _selecting = false;
          _emit();
          _renderPopover();
        };
      }
    }

    function _openPopover() {
      if (_popover) return;
      _popover = document.createElement('div');
      _popover.className = 'dp-popover-wrap';
      _popover.innerHTML = _buildPopover();
      document.body.appendChild(_popover);
      _positionPopover();
      _bindPopoverEvents();
      setTimeout(function () {
        document.addEventListener('click', _outsideClick);
      }, 0);
    }

    function _closePopover() {
      if (!_popover) return;
      _popover.remove();
      _popover = null;
      document.removeEventListener('click', _outsideClick);
    }

    function _outsideClick(e) {
      if (_popover && !_popover.contains(e.target) && _triggerEl && !_triggerEl.contains(e.target)) {
        _closePopover();
      }
    }

    function _positionPopover() {
      if (!_popover || !_triggerEl) return;
      var rect = _triggerEl.getBoundingClientRect();
      var scrollY = window.scrollY || window.pageYOffset;
      _popover.style.position  = 'fixed';
      _popover.style.top       = (rect.bottom + 4) + 'px';
      _popover.style.left      = rect.left + 'px';
      _popover.style.zIndex    = '9999';
    }

    function mount() {
      if (_mounted || !container) return;
      _mounted = true;

      // Build trigger row: ‹ [Label ▾] ›
      _triggerEl = document.createElement('div');
      _triggerEl.className = 'dp-trigger-row';
      _triggerEl.innerHTML =
        '<button class="dp-step-btn dp-prev-btn" aria-label="Previous period">‹</button>'
        + '<button class="dp-trigger-btn">'
        + '<span class="dp-label">' + _label() + '</span>'
        + ' <span class="dp-caret">▾</span>'
        + '</button>'
        + '<button class="dp-step-btn dp-next-btn" aria-label="Next period">›</button>';

      _triggerEl.querySelector('.dp-trigger-btn').onclick = function (e) {
        e.stopPropagation();
        if (_popover) _closePopover(); else _openPopover();
      };
      _triggerEl.querySelector('.dp-prev-btn').onclick = function (e) {
        e.stopPropagation();
        if (_preset !== 'custom') {
          _pivot = stepPivot(_preset, _pivot, -1);
          _emit();
        }
      };
      _triggerEl.querySelector('.dp-next-btn').onclick = function (e) {
        e.stopPropagation();
        if (_preset !== 'custom') {
          _pivot = stepPivot(_preset, _pivot, 1);
          _emit();
        }
      };

      container.appendChild(_triggerEl);
      _emit();
    }

    function destroy() {
      _closePopover();
      if (_triggerEl && _triggerEl.parentNode) _triggerEl.parentNode.removeChild(_triggerEl);
      _triggerEl = null;
      _mounted = false;
    }

    function getValue() { return _getRange(); }
    function getPreset() { return _preset; }

    return { mount: mount, destroy: destroy, getValue: getValue, getPreset: getPreset };
  }

  window.DatePickerV2 = { create: create, computeRange: computeRange };

})();
