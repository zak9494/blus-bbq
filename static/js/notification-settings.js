(function () {
  'use strict';

  var _settings   = null; // { channels: {}, events: {} }
  var _channels   = [];
  var _events     = [];
  var _saving     = false;
  var _tenantId   = 'default';

  var CHANNEL_LABELS = {
    push:   'Web Push',
    in_app: 'In-App (Bell)',
    email:  'Email',
    sms:    'SMS',
  };

  var EVENT_LABELS = {
    follow_up_due:        'Follow-up due',
    deposit_overdue:      'Deposit overdue',
    customer_reply:       'Customer replied',
    quote_sent:           'Quote sent',
    event_tomorrow:       'Event is tomorrow',
    event_today:          'Event is today',
    inquiry_needs_review: 'Inquiry needs review',
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getSecret() {
    return (window._appSecret || window.APP_SECRET || '');
  }

  function isEnabled(group, key) {
    if (!_settings || !_settings[group]) return true; // default ON
    var v = _settings[group][key];
    return v === undefined ? true : !!v;
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function renderPage() {
    var el = document.getElementById('ns-page-body');
    if (!el) return;

    if (!_settings) {
      el.innerHTML = '<div class="ns-empty">Loading…</div>';
      return;
    }

    var html = '';

    // Channel section
    html += '<div class="ns-section">';
    html += '<div class="ns-section-title">Channels</div>';
    html += '<div class="ns-section-desc">Choose how you want to receive notifications.</div>';
    html += '<div class="ns-rows">';
    (_channels.length ? _channels : ['push', 'in_app', 'email', 'sms']).forEach(function (ch) {
      var on = isEnabled('channels', ch);
      html += buildRow('ch', ch, CHANNEL_LABELS[ch] || ch, on);
    });
    html += '</div></div>';

    // Event section
    html += '<div class="ns-section">';
    html += '<div class="ns-section-title">Events</div>';
    html += '<div class="ns-section-desc">Choose which events trigger notifications.</div>';
    html += '<div class="ns-rows">';
    (_events.length ? _events : Object.keys(EVENT_LABELS)).forEach(function (ev) {
      var on = isEnabled('events', ev);
      html += buildRow('ev', ev, EVENT_LABELS[ev] || ev, on);
    });
    html += '</div></div>';

    el.innerHTML = html;
  }

  function buildRow(group, key, label, enabled) {
    var toggleId = 'ns-toggle-' + group + '-' + key;
    return '<div class="ns-row">'
      + '<div class="ns-row-label">' + label + '</div>'
      + '<label class="ns-switch">'
        + '<input type="checkbox" id="' + toggleId + '"'
          + (enabled ? ' checked' : '')
          + ' onchange="notifSettings.toggle(\'' + group + '\',\'' + key + '\',this.checked)">'
        + '<span class="ns-slider"></span>'
      + '</label>'
    + '</div>';
  }

  function showStatus(msg, isError) {
    var el = document.getElementById('ns-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ns-save-status ' + (isError ? 'ns-status-err' : 'ns-status-ok');
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 2500);
  }

  // ── Load / Save ──────────────────────────────────────────────────────────────
  async function loadSettings() {
    var el = document.getElementById('ns-page-body');
    if (el) el.innerHTML = '<div class="ns-empty">Loading…</div>';
    try {
      var url = '/api/notification-settings';
      if (_tenantId !== 'default') url += '?tenantId=' + encodeURIComponent(_tenantId);
      var r = await fetch(url);
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Failed');
      _settings = d.settings;
      _channels = d.channels || [];
      _events   = d.events   || [];
    } catch (e) {
      _settings = { channels: {}, events: {} };
      if (el) el.innerHTML = '<div class="ns-empty ns-empty-err">Failed to load settings: ' + (e.message || '') + '</div>';
      return;
    }
    renderPage();
  }

  async function saveToggle(group, key, value) {
    if (_saving) return;
    _saving = true;
    try {
      var body = { channels: {}, events: {}, secret: getSecret(), tenantId: _tenantId };
      body[group === 'ch' ? 'channels' : 'events'][key] = value;
      var r = await fetch('/api/notification-settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Save failed');
      // Merge response back
      if (d.settings) {
        _settings.channels = d.settings.channels;
        _settings.events   = d.settings.events;
      }
      showStatus('Saved', false);
    } catch (e) {
      showStatus('Save failed: ' + (e.message || ''), true);
      // Revert toggle
      var toggleId = 'ns-toggle-' + group + '-' + key;
      var el = document.getElementById(toggleId);
      if (el) el.checked = !value;
    } finally {
      _saving = false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.notifSettings = {
    init: function (tenantId) {
      _tenantId = tenantId || 'default';
      loadSettings();
    },

    toggle: function (group, key, value) {
      // Optimistically update local state
      if (!_settings) _settings = { channels: {}, events: {} };
      var groupKey = group === 'ch' ? 'channels' : 'events';
      if (!_settings[groupKey]) _settings[groupKey] = {};
      _settings[groupKey][key] = value;
      saveToggle(group, key, value);
    },

    reload: loadSettings,
  };

})();
