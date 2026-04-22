/* ===== MODULE: TEST MODE EMAIL SETTING
   Renders an email input on the Feature Flags page so the operator can
   configure where test-inquiry emails are routed.
   Always visible — not gated by the test_customer_mode flag.

   Exposes:
     window.testModeEmail.init()  — call after loadFlagsPage() renders
     window.testModeEmail.save()  — called by the Save button onclick
   ===== */
(function () {
  'use strict';

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function showToast(msg, isErr) {
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, isErr ? 'error' : 'success');
      return;
    }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:8px;' +
      'background:' + (isErr ? '#dc2626' : '#16a34a') + ';color:#fff;font-size:13px;z-index:9999;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  async function loadCurrentEmail() {
    try {
      var r = await fetch('/api/settings/test-mode-email');
      var d = await r.json();
      var input = document.getElementById('tm-email-input');
      if (input && d.email) input.value = d.email;
    } catch { /* silent */ }
  }

  async function saveEmail() {
    var input = document.getElementById('tm-email-input');
    var btn   = document.getElementById('tm-email-save');
    if (!input) return;
    var email = input.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Invalid email address', true);
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
    try {
      var r = await fetch('/api/settings/test-mode-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret(), email: email }),
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Save failed');
      showToast(email ? 'Test email target saved' : 'Test email target cleared');
    } catch (e) {
      showToast(e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  function render() {
    var panel = document.getElementById('test-email-panel');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = '1';
    panel.innerHTML =
      '<div style="padding:16px;background:var(--surface2);border:1px solid var(--border);border-radius:10px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text1);margin-bottom:4px">Test Mode Email Target</div>' +
        '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">' +
          'Test inquiry emails will be routed here. Leave blank to disable sending for test inquiries.' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="tm-email-input" type="email" placeholder="you@example.com"' +
            ' style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;' +
            'background:var(--surface1);color:var(--text1);font-size:13px">' +
          '<button id="tm-email-save" class="btn btn-sm"' +
            ' style="font-size:12px" onclick="window.testModeEmail.save()">Save</button>' +
        '</div>' +
      '</div>';
    loadCurrentEmail();
  }

  function init() {
    render();
  }

  window.testModeEmail = { init: init, save: saveEmail };
})();
