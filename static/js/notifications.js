/* ===== MODULE: PUSH NOTIFICATIONS (push-notifications feature)
   Registers the service worker, fetches the VAPID public key,
   subscribes/unsubscribes the browser, and POSTs the subscription
   to KV via /api/notifications/subscribe.

   Exposes:
     window.notifInit()        — call on page load; renders UI, recovers sub state
     window.notifSubscribe()   — request permission + subscribe
     window.notifUnsubscribe() — cancel subscription
     window.notifEnabled()     — returns true if currently subscribed
     window.notifSendTest()    — fire a test push (admin only)
   ===== */
(function () {
  'use strict';

  var _swReg      = null;  // ServiceWorkerRegistration
  var _sub        = null;  // PushSubscription
  var _publicKey  = null;  // VAPID public key (base64url)
  var _status     = 'idle'; // idle | loading | enabled | denied | unsupported | no-vapid

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent);
  }

  function isIOSStandalone() {
    return isIOS() && (window.navigator.standalone === true);
  }

  /* ── VAPID key fetch ──────────────────────────────────────────────── */
  async function fetchVapidKey() {
    try {
      var r = await fetch('/api/notifications/vapid-key');
      var d = await r.json();
      if (d.ok && d.publicKey) { _publicKey = d.publicKey; return true; }
      _status = 'no-vapid';
      return false;
    } catch(e) { _status = 'no-vapid'; return false; }
  }

  /* ── urlBase64ToUint8Array (required for applicationServerKey) ───── */
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw     = window.atob(base64);
    var arr     = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  /* ── SW registration ──────────────────────────────────────────────── */
  async function registerSW() {
    if (!supported()) return false;
    try {
      _swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      return true;
    } catch(e) { console.warn('SW registration failed:', e); return false; }
  }

  /* ── Get existing subscription ─────────────────────────────────────── */
  async function getExistingSub() {
    if (!_swReg) return null;
    try { return await _swReg.pushManager.getSubscription(); } catch(e) { return null; }
  }

  /* ── Subscribe ──────────────────────────────────────────────────────── */
  window.notifSubscribe = async function () {
    if (!supported()) { renderUI(); return; }
    if (!_swReg) await registerSW();
    if (!_publicKey) { var ok = await fetchVapidKey(); if (!ok) { renderUI(); return; } }

    // iOS requires the app to be in standalone mode (added to home screen)
    if (isIOS() && !isIOSStandalone()) {
      _status = 'ios-hint';
      renderUI();
      return;
    }

    var permission = Notification.permission;
    if (permission === 'denied') { _status = 'denied'; renderUI(); return; }
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') { _status = 'denied'; renderUI(); return; }

    try {
      _sub = await _swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(_publicKey),
      });
      // POST subscription to KV
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret(), subscription: _sub.toJSON() }),
      });
      _status = 'enabled';
    } catch(e) {
      console.warn('Push subscribe failed:', e);
      _status = 'denied';
    }
    renderUI();
  };

  /* ── Unsubscribe ────────────────────────────────────────────────────── */
  window.notifUnsubscribe = async function () {
    if (_sub) {
      var endpoint = _sub.endpoint;
      try {
        await _sub.unsubscribe();
        await fetch('/api/notifications/subscribe?secret=' + encodeURIComponent(secret()) +
                    '&endpoint=' + encodeURIComponent(endpoint), { method: 'DELETE' });
      } catch(e) { /* non-fatal */ }
      _sub = null;
    }
    _status = 'idle';
    renderUI();
  };

  /* ── notifEnabled ───────────────────────────────────────────────────── */
  window.notifEnabled = function () { return _status === 'enabled'; };

  /* ── notifSendTest ──────────────────────────────────────────────────── */
  window.notifSendTest = async function () {
    try {
      var r = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: secret(),
          title: "Blu's BBQ — Test",
          body: 'Push notifications are working! 🔥',
          url: '/',
          tag: 'blus-test',
        }),
      });
      var d = await r.json();
      if (d.ok) alert('Test push sent! (' + d.sent + ' delivered)');
      else alert('Send failed: ' + (d.error || 'unknown'));
    } catch(e) { alert('Error: ' + e.message); }
  };

  /* ── renderUI ───────────────────────────────────────────────────────── */
  function renderUI() {
    var el = document.getElementById('notif-prefs-widget');
    if (!el) return;

    if (!supported()) {
      el.innerHTML = '<div class="notif-status-line">Push notifications not supported in this browser.</div>';
      return;
    }

    var btnLabel, btnClass, statusText, extraHtml = '';

    if (_status === 'no-vapid') {
      el.innerHTML = '<div class="notif-status-line" style="color:var(--text3)">Notifications not configured (VAPID keys missing).</div>';
      return;
    }

    if (_status === 'ios-hint') {
      el.innerHTML =
        '<div class="notif-ios-hint">To enable push on iPhone/iPad, tap the Share button → "Add to Home Screen", then reopen the app and try again.</div>';
      return;
    }

    if (_status === 'enabled') {
      btnLabel  = '🔔 Enabled';
      btnClass  = 'notif-toggle-btn notif-enabled';
      statusText = 'You\'ll receive alerts for new inquiries and urgent pipeline items.';
      extraHtml = '<button class="notif-test-btn" onclick="notifSendTest()">Send test notification</button>' +
                  ' · <button class="notif-test-btn" onclick="notifUnsubscribe()">Disable</button>';
    } else if (_status === 'denied') {
      btnLabel  = '🔕 Blocked';
      btnClass  = 'notif-toggle-btn notif-denied';
      statusText = 'Notifications blocked. Allow them in browser settings.';
    } else {
      btnLabel  = '🔔 Enable Notifications';
      btnClass  = 'notif-toggle-btn';
      statusText = 'Get alerts for new inquiries and urgent items.';
    }

    el.innerHTML =
      '<div class="notif-toggle-row">' +
        '<span class="notif-toggle-label">Push Alerts</span>' +
        '<button class="' + btnClass + '" onclick="' +
          (_status === 'enabled' ? '' : 'notifSubscribe()') + '">' + btnLabel + '</button>' +
      '</div>' +
      '<div class="notif-status-line">' + statusText + '</div>' +
      (extraHtml ? '<div style="margin-bottom:4px">' + extraHtml + '</div>' : '');
  }

  /* ── notifInit — call once on app load ──────────────────────────────── */
  window.notifInit = async function () {
    if (!supported()) { _status = 'unsupported'; renderUI(); return; }

    var swOk = await registerSW();
    if (!swOk) { renderUI(); return; }

    // Check for existing subscription
    _sub = await getExistingSub();
    if (_sub) {
      _status = 'enabled';
    } else if (Notification.permission === 'denied') {
      _status = 'denied';
    } else {
      _status = 'idle';
    }
    renderUI();
  };

})();
