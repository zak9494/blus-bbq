/* ===== MODULE: bottom-sheet
   Reusable iOS-style bottom-sheet for confirmations and choices.
   Replaces native confirm() dialogs with an accessible, animated panel.

   API:
     BottomSheet.open({ title, body, actions })
     BottomSheet.close()

   actions: [{ label, style, onClick }]
     style: 'primary' | 'danger' | 'cancel' | (default secondary)
   ===== */
(function () {
  var ROOT_ID    = 'bottom-sheet-root';
  var PANEL_ID   = 'bottom-sheet-panel';
  var OVERLAY_ID = 'bottom-sheet-overlay';
  var TITLE_ID   = 'bottom-sheet-title';
  var BODY_ID    = 'bottom-sheet-body';
  var ACTIONS_ID = 'bottom-sheet-actions';

  function ensureShell() {
    if (document.getElementById(ROOT_ID)) return;
    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML =
      '<div id="' + OVERLAY_ID + '" class="bs-overlay" role="presentation"></div>' +
      '<div id="' + PANEL_ID + '" class="bs-panel" role="dialog" aria-modal="true" aria-labelledby="' + TITLE_ID + '">' +
        '<div class="bs-handle" aria-hidden="true"></div>' +
        '<div id="' + TITLE_ID + '" class="bs-title"></div>' +
        '<div id="' + BODY_ID  + '" class="bs-body"></div>' +
        '<div id="' + ACTIONS_ID + '" class="bs-actions"></div>' +
      '</div>';
    document.body.appendChild(root);
    document.getElementById(OVERLAY_ID).addEventListener('click', close);
    initSwipeToDismiss(document.getElementById(PANEL_ID));
  }

  function initSwipeToDismiss(panel) {
    var startY = 0, dragging = false;
    panel.addEventListener('touchstart', function (e) {
      if (!e.target.closest('.bs-handle')) return;
      startY = e.touches[0].clientY;
      dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 0) panel.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    panel.addEventListener('touchend', function (e) {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      var dy = e.changedTouches[0].clientY - startY;
      if (dy > 80) {
        close();
      } else {
        panel.style.transform = '';
      }
    });
  }

  function open(opts) {
    opts = opts || {};
    ensureShell();

    var overlay = document.getElementById(OVERLAY_ID);
    var panel   = document.getElementById(PANEL_ID);
    var titleEl = document.getElementById(TITLE_ID);
    var bodyEl  = document.getElementById(BODY_ID);
    var actEl   = document.getElementById(ACTIONS_ID);

    titleEl.textContent   = opts.title || '';
    titleEl.style.display = opts.title ? '' : 'none';

    if (typeof opts.body === 'string') {
      bodyEl.innerHTML = opts.body;
    } else if (opts.body && opts.body.nodeType) {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(opts.body);
    } else {
      bodyEl.innerHTML = '';
    }
    bodyEl.style.display = opts.body ? '' : 'none';

    actEl.innerHTML = '';
    (opts.actions || []).forEach(function (action) {
      var btn = document.createElement('button');
      btn.className = 'bs-btn' + (action.style ? ' bs-btn-' + action.style : '');
      btn.textContent = action.label || '';
      btn.addEventListener('click', function () {
        close();
        if (typeof action.onClick === 'function') action.onClick();
      });
      actEl.appendChild(btn);
    });

    overlay.classList.add('bs-open');
    panel.classList.add('bs-open');
    panel.style.transform = '';

    if (window.scrollLock) window.scrollLock.lock();
    document.addEventListener('keydown', onKey);

    // Focus trap — move focus into panel
    setTimeout(function () {
      var first = panel.querySelector('button');
      if (first) first.focus();
    }, 310);
  }

  function close() {
    var overlay = document.getElementById(OVERLAY_ID);
    var panel   = document.getElementById(PANEL_ID);
    if (!overlay || !panel) return;
    overlay.classList.remove('bs-open');
    panel.classList.remove('bs-open');
    if (window.scrollLock) window.scrollLock.unlock();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  window.BottomSheet = { open: open, close: close };
}());
