/* ===== MODULE: mark-lost-modal
   Feature flag: lost_reasons_v1 (default OFF).

   Opens a full-screen modal with 7 reason buttons. After picking, shows an
   optional notes field. On Confirm: POSTs to /api/orders/mark-lost.

   Exposes: window.markLostModal = { open(threadId, onConfirm, onCancel) }
   ===== */
(function () {
  'use strict';

  var REASONS = [
    { code: 'declined',             label: 'Declined' },
    { code: 'no_response_customer', label: 'No Response (Customer)' },
    { code: 'no_response_us',       label: 'No Response (Us)' },
    { code: 'out_of_range',         label: 'Out of Range' },
    { code: 'booked_elsewhere',     label: 'Booked Elsewhere' },
    { code: 'budget_mismatch',      label: 'Budget Mismatch' },
    { code: 'other',                label: 'Other' },
  ];

  function isEnabled() {
    return !!(window.flags && typeof window.flags.isEnabled === 'function'
      && window.flags.isEnabled('lost_reasons_v1'));
  }

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var _overlay = null;
  var _onConfirm = null;
  var _onCancel  = null;
  var _threadId  = null;
  var _selected  = null;

  function _close() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null; _onConfirm = null; _onCancel = null; _threadId = null; _selected = null;
  }

  function _cancel() {
    var cb = _onCancel;
    _close();
    if (cb) cb();
  }

  function _render() {
    var overlay = document.createElement('div');
    overlay.className = 'mlm-overlay';
    overlay.innerHTML =
      '<div class="mlm-sheet" role="dialog" aria-modal="true" aria-label="Mark as Lost">'
      + '<div class="mlm-header">'
        + '<span class="mlm-title">Mark as Lost</span>'
        + '<button class="mlm-close" aria-label="Cancel">&times;</button>'
      + '</div>'
      + '<p class="mlm-subtitle">Why is this lead lost?</p>'
      + '<div class="mlm-reasons">'
        + REASONS.map(function (r) {
            return '<button class="mlm-reason-btn" data-code="' + escHtml(r.code) + '">'
              + escHtml(r.label) + '</button>';
          }).join('')
      + '</div>'
      + '<div class="mlm-notes-wrap" style="display:none">'
        + '<textarea class="mlm-notes" placeholder="Optional notes\u2026" maxlength="500" rows="3"></textarea>'
        + '<div class="mlm-notes-counter"><span class="mlm-notes-len">0</span>/500</div>'
      + '</div>'
      + '<div class="mlm-actions">'
        + '<button class="mlm-btn mlm-btn-cancel">Cancel</button>'
        + '<button class="mlm-btn mlm-btn-confirm" disabled>Confirm Lost</button>'
      + '</div>'
      + '<div class="mlm-error" style="display:none"></div>'
    + '</div>';

    overlay.querySelector('.mlm-close').addEventListener('click', _cancel);
    overlay.querySelector('.mlm-btn-cancel').addEventListener('click', _cancel);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _cancel();
    });

    overlay.querySelectorAll('.mlm-reason-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        overlay.querySelectorAll('.mlm-reason-btn').forEach(function (b) { b.classList.remove('mlm-selected'); });
        btn.classList.add('mlm-selected');
        _selected = btn.getAttribute('data-code');
        overlay.querySelector('.mlm-notes-wrap').style.display = '';
        overlay.querySelector('.mlm-btn-confirm').disabled = false;
      });
    });

    var notes = overlay.querySelector('.mlm-notes');
    var counter = overlay.querySelector('.mlm-notes-len');
    notes.addEventListener('input', function () {
      counter.textContent = notes.value.length;
    });

    overlay.querySelector('.mlm-btn-confirm').addEventListener('click', function () {
      if (!_selected) return;
      _submit(overlay);
    });

    _overlay = overlay;
    document.body.appendChild(overlay);
    setTimeout(function () { overlay.classList.add('mlm-visible'); }, 10);
  }

  function _submit(overlay) {
    if (!_selected || !_threadId) return;
    var confirmBtn = overlay.querySelector('.mlm-btn-confirm');
    var errEl = overlay.querySelector('.mlm-error');
    var notes = overlay.querySelector('.mlm-notes').value.trim();

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving\u2026';
    errEl.style.display = 'none';

    fetch('/api/orders/mark-lost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Secret': getSecret() },
      body: JSON.stringify({ id: _threadId, reason: _selected, notes: notes || undefined }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || 'Failed to save');
        var cb = _onConfirm;
        _close();
        if (cb) cb(_selected, notes);
      })
      .catch(function (e) {
        errEl.textContent = e.message || 'Error saving';
        errEl.style.display = '';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Lost';
      });
  }

  function open(threadId, onConfirm, onCancel) {
    if (!isEnabled()) {
      if (onCancel) onCancel();
      return;
    }
    if (_overlay) _close();
    _threadId  = threadId;
    _onConfirm = onConfirm;
    _onCancel  = onCancel;
    _selected  = null;
    _render();
  }

  window.markLostModal = { open: open };
}());
