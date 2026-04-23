/* ===== MODULE: lost-reason-sheet
   Wave 1 — BottomSheet for capturing why a lead was lost.
   Feature flag: lost_reason_capture (default true).

   Fetches reason options from /api/settings/lost-reasons (cached).
   Falls back to seeded defaults if endpoint unavailable.

   API:
     lostReasonSheet.open(threadId, onConfirm, onCancel)
       onConfirm(reason: string|null) — called with selected reason or null (skip)
       onCancel()                     — called on ESC / backdrop dismiss

   Exposes: window.lostReasonSheet
   ===== */
(function () {
  'use strict';

  var DEFAULT_REASONS = [
    'Budget too high',
    'Competitor',
    'No response from customer',
    'Event cancelled',
    'Other',
  ];

  var _reasonsCache = null;
  var _fetchPromise = null;

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function isEnabled() {
    return !window.flags || !window.flags.isEnabled || window.flags.isEnabled('lost_reason_capture');
  }

  function fetchReasons() {
    if (_reasonsCache) return Promise.resolve(_reasonsCache);
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = fetch('/api/settings/lost-reasons?secret=' + encodeURIComponent(getSecret()), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _reasonsCache = (d.ok && Array.isArray(d.reasons) && d.reasons.length) ? d.reasons : DEFAULT_REASONS.slice();
        _fetchPromise = null;
        return _reasonsCache;
      })
      .catch(function () {
        _fetchPromise = null;
        return DEFAULT_REASONS.slice();
      });
    return _fetchPromise;
  }

  /* ── Build BottomSheet body DOM ── */

  function buildBody(reasons, onSelect) {
    var wrap = document.createElement('div');
    wrap.className = 'lrs-wrap';

    var grid = document.createElement('div');
    grid.className = 'lrs-grid';

    var selected = null;
    var otherInput = null;

    reasons.forEach(function (r) {
      var btn = document.createElement('button');
      btn.className = 'lrs-btn';
      btn.textContent = r;
      btn.setAttribute('data-reason', r);

      btn.addEventListener('click', function () {
        grid.querySelectorAll('.lrs-btn').forEach(function (b) { b.classList.remove('lrs-btn-active'); });
        btn.classList.add('lrs-btn-active');
        selected = r;
        if (otherInput) {
          otherInput.style.display = (r === 'Other') ? 'block' : 'none';
          if (r === 'Other') otherInput.focus();
        }
        onSelect(r, otherInput);
      });

      grid.appendChild(btn);
    });

    wrap.appendChild(grid);

    // "Other" free-text
    otherInput = document.createElement('textarea');
    otherInput.className = 'lrs-other';
    otherInput.placeholder = 'Describe reason\u2026';
    otherInput.rows = 2;
    otherInput.style.display = 'none';
    wrap.appendChild(otherInput);

    wrap._getSelected = function () { return selected; };
    wrap._getOtherText = function () { return (otherInput && otherInput.value.trim()) || ''; };

    return wrap;
  }

  /* ── Public open() ── */

  function open(threadId, onConfirm, onCancel) {
    if (!window.BottomSheet) {
      // Fallback: just confirm immediately with no reason
      if (typeof onConfirm === 'function') onConfirm(null);
      return;
    }

    if (!isEnabled()) {
      if (typeof onConfirm === 'function') onConfirm(null);
      return;
    }

    var bodyEl = document.createElement('div');
    bodyEl.textContent = 'Loading\u2026';
    bodyEl.style.cssText = 'font-size:13px;color:var(--text3);padding:8px 0';

    var confirmed = false;
    var selectedReason = null;
    var bodyWrap = null;

    window.BottomSheet.open({
      title: 'Why was this lead lost?',
      body: bodyEl,
      actions: [
        {
          label: 'Skip',
          style: 'cancel',
          onClick: function () {
            if (!confirmed) {
              confirmed = true;
              if (typeof onConfirm === 'function') onConfirm(null);
            }
          }
        },
        {
          label: 'Mark Lost',
          style: 'primary',
          onClick: function () {
            confirmed = true;
            var reason = null;
            if (bodyWrap) {
              reason = bodyWrap._getSelected();
              if (reason === 'Other') {
                var txt = bodyWrap._getOtherText();
                reason = txt || 'Other';
              }
            }
            if (typeof onConfirm === 'function') onConfirm(reason);
          }
        }
      ]
    });

    // Load reasons async and swap body content
    fetchReasons().then(function (reasons) {
      bodyWrap = buildBody(reasons, function (r, inp) {
        selectedReason = r;
      });
      var bsBody = document.getElementById('bottom-sheet-body');
      if (bsBody) {
        bsBody.innerHTML = '';
        bsBody.appendChild(bodyWrap);
        bsBody.style.display = '';
      }
    });
  }

  /* Invalidate cache so updated reasons are picked up next open */
  function invalidateCache() { _reasonsCache = null; }

  window.lostReasonSheet = { open: open, invalidateCache: invalidateCache };
}());
