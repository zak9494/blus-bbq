/* ===== MODULE: pull-to-refresh
   Native-feeling pull-to-refresh for the main scrollable views (mobile only).
   Desktop (no touch) is a no-op.

   API:
     PullToRefresh.activate(asyncFn)   — enable for current page
     PullToRefresh.deactivate()        — disable when leaving page

   Call activate() in the page's showPage handler, deactivate() on leave.
   ===== */
(function () {
  var THRESHOLD     = 70;   // px pull distance to trigger refresh
  var MAX_PULL      = 110;  // rubber-band cap (px)
  var SNAP_HEIGHT   = 44;   // indicator height while loading (px)
  var EASING        = 0.52; // rubber-band coefficient (< 1 = spring feel)

  var refreshFn  = null;
  var active     = false;
  var indicator  = null;
  var startY     = 0;
  var pulling    = false;
  var triggered  = false;
  var refreshing = false;

  /* ── Indicator element ── */
  function getIndicator() {
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.className = 'ptr-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<div class="ptr-spinner"></div>';
    indicator.style.cssText = 'height:0;overflow:hidden;transition:none;opacity:0;';
    // Insert at the very top of .main so it appears under the topbar
    var main = document.querySelector('.main') || document.body;
    main.insertBefore(indicator, main.firstChild);
    return indicator;
  }

  /* ── Touch handlers ── */
  function onStart(e) {
    if (!active || refreshing) return;
    if (window.scrollY > 2) return;  // only at page top
    startY   = e.touches[0].clientY;
    pulling  = true;
    triggered = false;
  }

  function onMove(e) {
    if (!pulling || !active) return;
    if (window.scrollY > 2) { pulling = false; return; }
    var dy   = e.touches[0].clientY - startY;
    if (dy <= 0) { pulling = false; return; }
    var pull = Math.min(dy * EASING, MAX_PULL);
    var ind  = getIndicator();
    ind.style.transition = 'none';
    ind.style.height  = pull + 'px';
    ind.style.opacity = Math.min(pull / THRESHOLD, 1).toFixed(2);
    triggered = pull >= THRESHOLD * 0.8;
    ind.classList.toggle('ptr-ready', triggered);
  }

  async function onEnd() {
    if (!pulling) return;
    pulling = false;
    var ind = getIndicator();
    if (triggered && !refreshing && refreshFn) {
      refreshing = true;
      ind.classList.add('ptr-loading');
      ind.style.transition = 'height 0.2s';
      ind.style.height     = SNAP_HEIGHT + 'px';
      ind.style.opacity    = '1';
      try { await refreshFn(); } catch (_) {}
      ind.style.transition = 'height 0.3s ease, opacity 0.3s ease';
      ind.style.height     = '0';
      ind.style.opacity    = '0';
      setTimeout(function () {
        ind.style.transition = 'none';
        ind.classList.remove('ptr-loading', 'ptr-ready');
        refreshing = false;
      }, 320);
    } else {
      ind.style.transition = 'height 0.25s ease, opacity 0.25s ease';
      ind.style.height     = '0';
      ind.style.opacity    = '0';
      setTimeout(function () {
        ind.style.transition = 'none';
        ind.classList.remove('ptr-ready');
      }, 270);
    }
  }

  /* Bootstrap touch listeners once (passive for performance) */
  if ('ontouchstart' in window) {
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove',  onMove,  { passive: true });
    document.addEventListener('touchend',   onEnd);
  }

  function activate(fn) {
    refreshFn = fn;
    active    = true;
  }

  function deactivate() {
    active    = false;
    refreshFn = null;
    if (indicator) {
      indicator.style.transition = 'none';
      indicator.style.height     = '0';
      indicator.style.opacity    = '0';
      indicator.classList.remove('ptr-ready', 'ptr-loading');
    }
  }

  window.PullToRefresh = { activate: activate, deactivate: deactivate };
}());
