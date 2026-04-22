/* ===== MODULE: MOBILE SCROLL-WHEEL TIME PICKER
   File: /static/js/time-picker.js
   Replaces input[type="time"] on mobile/tablet viewports (<768px) with a
   CSS scroll-snap drum-roll picker (hours · minutes · AM/PM).
   Desktop: native input is shown, wheel is hidden.
   Exposes: window.twInit(selector) — call after DOM ready.
   ===== */

(function () {
  'use strict';

  var ITEM_H = 40;   /* px height of each row   */
  var BP     = 768;  /* px breakpoint for mobile */
  var HOURS  = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  var MINS   = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  var APS    = ['AM', 'PM'];

  function pad(n) { return String(n).padStart(2, '0'); }

  /* Parse "HH:MM" (24h) → { h: 1–12, min: 0–55(snap5), ap: 'AM'|'PM' } */
  function parse24(v) {
    var m = (v || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return { h: 12, min: 0, ap: 'AM' };
    var h = +m[1], raw = +m[2];
    var min = Math.round(raw / 5) * 5;
    if (min >= 60) min = 55;
    return { h: h % 12 || 12, min: min, ap: h >= 12 ? 'PM' : 'AM' };
  }

  /* { h: 1–12, min, ap } → "HH:MM" 24h */
  function to24(h, min, ap) {
    var h24 = h % 12 + (ap === 'PM' ? 12 : 0);
    return pad(h24) + ':' + pad(min);
  }

  /* Build one scrollable column */
  function mkCol(items, extraClass) {
    var col = document.createElement('div');
    col.className = 'tw-col' + (extraClass ? ' ' + extraClass : '');
    /* leading ghost */
    var g1 = document.createElement('div');
    g1.className = 'tw-item tw-pad';
    col.appendChild(g1);
    /* real items */
    items.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'tw-item';
      el.textContent = typeof v === 'number' ? pad(v) : String(v);
      col.appendChild(el);
    });
    /* trailing ghost */
    var g2 = document.createElement('div');
    g2.className = 'tw-item tw-pad';
    col.appendChild(g2);
    return col;
  }

  /* Instantly scroll column so items[idx] is centred */
  function scrollTo(col, idx) {
    col.scrollTop = idx * ITEM_H;
  }

  /* Read which item is centred from current scrollTop */
  function getIdx(col) {
    return Math.round(col.scrollTop / ITEM_H);
  }

  function attachOne(input) {
    if (input._twDone) return;
    input._twDone = true;

    var colH  = mkCol(HOURS, '');
    var colM  = mkCol(MINS,  '');
    var colAP = mkCol(APS,   'tw-col-ap');
    var sep   = document.createElement('div');
    sep.className = 'tw-sep';
    sep.textContent = ':';

    var wheel = document.createElement('div');
    wheel.className = 'tw-wheel';
    wheel.appendChild(colH);
    wheel.appendChild(sep);
    wheel.appendChild(colM);
    wheel.appendChild(colAP);

    /* Insert wheel right after the native input */
    input.parentNode.insertBefore(wheel, input.nextSibling);

    /* Sync native input value → wheel scroll positions */
    function syncToWheel() {
      var t    = parse24(input.value);
      var hIdx = HOURS.indexOf(t.h);
      var mIdx = MINS.indexOf(t.min);
      var aIdx = APS.indexOf(t.ap);
      scrollTo(colH,  hIdx < 0 ? 0 : hIdx);
      scrollTo(colM,  mIdx < 0 ? 0 : mIdx);
      scrollTo(colAP, aIdx < 0 ? 0 : aIdx);
    }

    /* Sync wheel positions → native input value */
    var syncTimer;
    function syncToInput() {
      var h  = HOURS[Math.min(getIdx(colH),  HOURS.length - 1)] || 12;
      var m  = MINS[Math.min(getIdx(colM),   MINS.length  - 1)] || 0;
      var ap = APS[Math.min(getIdx(colAP),   APS.length   - 1)] || 'AM';
      var v  = to24(h, m, ap);
      if (v !== input.value) {
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    [colH, colM, colAP].forEach(function (col) {
      col.addEventListener('scroll', function () {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncToInput, 120);
      }, { passive: true });
    });

    /* When native input is programmatically changed, update wheel */
    input.addEventListener('change', syncToWheel);

    /* Show/hide based on viewport width */
    function apply() {
      var mob = window.innerWidth < BP;
      input.style.display = mob ? 'none' : '';
      wheel.style.display = mob ? 'flex' : 'none';
      if (mob && !wheel._init) {
        wheel._init = true;
        /* rAF ensures columns are painted before scrollTo takes effect */
        requestAnimationFrame(function () {
          if (input.value) {
            syncToWheel();
          } else {
            /* Default to 12:00 PM */
            scrollTo(colH,  0);  /* HOURS[0] = 12 */
            scrollTo(colM,  0);  /* MINS[0] = 0   */
            scrollTo(colAP, 1);  /* PM             */
            input.value = '12:00';
          }
        });
      }
    }

    apply();
    window.addEventListener('resize', apply, { passive: true });
  }

  /* Public: attach to all time inputs matching selector */
  function twInit(selector) {
    document.querySelectorAll(selector || 'input[type="time"]').forEach(attachOne);
  }

  window.twInit   = twInit;
  window.twAttach = attachOne;
})();
