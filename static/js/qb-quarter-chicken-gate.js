/* ===== MODULE: QUOTE BUILDER — QUARTER CHICKEN 3+ MEAT GATE
   File: static/js/qb-quarter-chicken-gate.js

   Quarter Chicken (`chicken-quarter`) is only available when the customer has
   selected 3 or more *other* meats. Re-evaluates on every meat checkbox change.

   Gated by feature flag `qb_quarter_chicken_3meat`:
     • Flag OFF — quarter chicken row is hidden entirely.
     • Flag ON  — row shown; checkbox disabled until 3+ meats chosen; if the
                  selection later drops below 3, a previously-checked quarter
                  chicken is auto-cleared.

   Counting rule: any checked checkbox in #menu-meats EXCEPT chicken-quarter
   itself. Packages are NOT counted (different element); buffet-package "3 meat"
   selection does not satisfy the gate.

   Initialized from index.html after `init()` builds the menu picker and after
   `window.flags.load()` resolves.
   ===== */
(function () {
  'use strict';

  var QUARTER_ID = 'chicken-quarter';
  var MIN_MEATS  = 3;
  var FLAG_NAME  = 'qb_quarter_chicken_3meat';
  var DISABLED_TIP = 'Select 3 or more meats to add Quarter Chicken';

  function flagOn() {
    return !!(window.flags && typeof window.flags.isEnabled === 'function'
              && window.flags.isEnabled(FLAG_NAME));
  }

  function quarterCheckbox() {
    return document.querySelector('#menu-meats input[data-id="' + QUARTER_ID + '"]');
  }

  function quarterRow() {
    var cb = quarterCheckbox();
    if (!cb) return null;
    var label = cb.closest('.menu-item-check');
    return label ? label.parentElement : null;
  }

  function selectedNonQuarterMeatCount() {
    var checked = document.querySelectorAll(
      '#menu-meats input[type="checkbox"][data-id]:checked'
    );
    var n = 0;
    for (var i = 0; i < checked.length; i++) {
      if (checked[i].getAttribute('data-id') !== QUARTER_ID) n++;
    }
    return n;
  }

  function evaluate() {
    var cb = quarterCheckbox();
    if (!cb) return;
    var enabled = selectedNonQuarterMeatCount() >= MIN_MEATS;
    var label   = cb.closest('.menu-item-check');
    cb.disabled = !enabled;
    cb.setAttribute('data-meat-gated', enabled ? 'enabled' : 'disabled');
    if (label) {
      label.classList.toggle('qb-quarter-disabled', !enabled);
      label.title = enabled ? '' : DISABLED_TIP;
    }
    if (!enabled && cb.checked) {
      // Toggle off via click() so the inline onchange handler updates
      // selectedItems and refreshes the preview.
      cb.click();
    }
  }

  function attach() {
    var grid = document.getElementById('menu-meats');
    if (!grid || grid._qbQuarterGateAttached) return !!grid;
    grid.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[type="checkbox"][data-id]')) {
        // Defer one tick so the inline toggleItem() runs first.
        setTimeout(evaluate, 0);
      }
    });
    grid._qbQuarterGateAttached = true;
    return true;
  }

  function init() {
    var row = quarterRow();
    if (!flagOn()) {
      if (row) row.style.display = 'none';
      return;
    }
    if (row) row.style.display = '';
    if (!attach()) return;
    evaluate();
  }

  window.qbQuarterChickenGate = {
    init: init,
    evaluate: evaluate,
    _flagName: FLAG_NAME,
    _quarterId: QUARTER_ID,
    _minMeats: MIN_MEATS,
  };
})();
