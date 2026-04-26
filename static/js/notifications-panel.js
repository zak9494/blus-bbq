(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var _notifications = [];
  var _unreadCount   = 0;
  var _types         = [];
  var _settings      = {};
  var _drawerOpen    = false;
  var _pollTimer     = null;
  var _audioCtx      = null;
  var _pageFilter    = 'all';
  var _pageOffset    = 0;
  var _pageLimit     = 20;
  var _inited        = false;

  // ── Icon map ───────────────────────────────────────────────────────────────
  var ICONS = {
    clock:    '⏰',
    dollar:   '💵',
    message:  '💬',
    document: '📄',
    calendar: '📅',
    eye:      '👁',
    bell:     '🔔',
    star:     '⭐',
    alert:    '⚠️',
    check:    '✅',
  };
  var DEFAULT_ICON = '🔔';

  // ── Sound engine (Web Audio API) ───────────────────────────────────────────
  var SOUND_FNS = {
    chime: function (ctx, vol) {
      try {
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        g.connect(ctx.destination);
        [880, 1320].forEach(function (hz, i) {
          var osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(hz, ctx.currentTime + i * 0.12);
          osc.connect(g);
          osc.start(ctx.currentTime + i * 0.12);
          osc.stop(ctx.currentTime + i * 0.12 + 0.25);
        });
      } catch (_) {}
    },
    alert: function (ctx, vol) {
      try {
        [0, 0.12, 0.24].forEach(function (t) {
          var g = ctx.createGain();
          g.gain.setValueAtTime(vol, ctx.currentTime + t);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.1);
          g.connect(ctx.destination);
          var osc = ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(1100, ctx.currentTime + t);
          osc.connect(g);
          osc.start(ctx.currentTime + t);
          osc.stop(ctx.currentTime + t + 0.1);
        });
      } catch (_) {}
    },
    ding: function (ctx, vol) {
      try {
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        g.connect(ctx.destination);
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046, ctx.currentTime);
        osc.connect(g);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } catch (_) {}
    },
    whoosh: function (ctx, vol) {
      try {
        var buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(400, ctx.currentTime);
        filt.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.3);
        filt.Q.value = 1.5;
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        src.connect(filt);
        filt.connect(g);
        g.connect(ctx.destination);
        src.start(ctx.currentTime);
        src.stop(ctx.currentTime + 0.4);
      } catch (_) {}
    },
    none: function () {},
  };

  function getAudioCtx() {
    if (!_audioCtx) {
      try {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (Ctor) _audioCtx = new Ctor();
      } catch (_) {}
    }
    return _audioCtx;
  }

  function playSound(soundName, volume) {
    var fn = SOUND_FNS[soundName] || SOUND_FNS.none;
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().then(function () { fn(ctx, volume || 0.4); });
    else fn(ctx, volume || 0.4);
  }

  // ── LocalStorage settings ──────────────────────────────────────────────────
  var SETTINGS_KEY = 'nc_type_settings';

  function loadSettings() {
    try {
      _settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (_) { _settings = {}; }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings)); } catch (_) {}
  }

  function getTypeSetting(typeId, field, def) {
    return (_settings[typeId] && _settings[typeId][field] !== undefined)
      ? _settings[typeId][field] : def;
  }

  function setTypeSetting(typeId, field, val) {
    if (!_settings[typeId]) _settings[typeId] = {};
    _settings[typeId][field] = val;
    saveSettings();
  }

  // ── API helpers ────────────────────────────────────────────────────────────
  function apiFetch(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  function poll() {
    apiFetch('/api/notifications/counts').then(function (d) {
      if (!d || !d.ok) return;
      var prev = _unreadCount;
      _unreadCount = d.unread_count || 0;
      updateBadge(_unreadCount);
      if (_unreadCount > prev) {
        apiFetch('/api/notifications?limit=5&offset=0').then(function (nd) {
          if (!nd || !nd.ok) return;
          var fresh = nd.notifications || [];
          fresh.slice(0, _unreadCount - prev).forEach(function (n) {
            var sound = getTypeSetting(n.type, 'sound', 'ding');
            var muted = getTypeSetting(n.type, 'muted', false);
            if (!muted) playSound(sound, 0.4);
          });
          _notifications = fresh;
          if (_drawerOpen) renderDrawerList();
        });
      }
    }).catch(function () {});
  }

  // ── Bell / badge ───────────────────────────────────────────────────────────
  function showBell() {
    var btn = document.getElementById('nc-bell-btn');
    if (btn) btn.style.display = 'flex';
  }

  function updateBadge(count) {
    var badge = document.getElementById('nc-bell-badge');
    var navBadge = document.getElementById('nc-nav-badge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
    if (navBadge) {
      navBadge.textContent = count > 99 ? '99+' : String(count);
      navBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  // ── Nav item ───────────────────────────────────────────────────────────────
  function showNavItem() {
    var el = document.getElementById('nc-nav-item');
    if (el) el.style.display = '';
  }

  // ── Drawer ─────────────────────────────────────────────────────────────────
  function openDrawer() {
    _drawerOpen = true;
    var overlay = document.getElementById('nc-drawer-overlay');
    var drawer  = document.getElementById('nc-drawer');
    if (overlay) overlay.style.display = 'block';
    if (drawer) {
      drawer.style.display = 'flex';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (drawer) drawer.classList.add('nc-drawer-open');
        });
      });
    }
    loadDrawerPage();
  }

  function closeDrawer() {
    _drawerOpen = false;
    var overlay = document.getElementById('nc-drawer-overlay');
    var drawer  = document.getElementById('nc-drawer');
    if (drawer) drawer.classList.remove('nc-drawer-open');
    setTimeout(function () {
      if (overlay) overlay.style.display = 'none';
      if (drawer)  drawer.style.display  = 'none';
    }, 250);
  }

  function loadDrawerPage() {
    apiFetch('/api/notifications?limit=20&offset=0').then(function (d) {
      if (!d || !d.ok) return;
      _notifications = d.notifications || [];
      _unreadCount   = d.unread_count  || 0;
      updateBadge(_unreadCount);
      renderDrawerList();
    }).catch(function () {});
  }

  function renderDrawerList() {
    var list = document.getElementById('nc-drawer-list');
    if (!list) return;
    if (!_notifications.length) {
      list.innerHTML = '<div class="nc-empty">No notifications yet.</div>';
      return;
    }
    list.innerHTML = _notifications.map(function (n) { return renderRow(n, true); }).join('');
  }

  // ── Row rendering ──────────────────────────────────────────────────────────
  function renderRow(n, inDrawer) {
    var typeConf = (_types || []).find(function (t) { return t.id === n.type; }) || {};
    var iconKey  = getTypeSetting(n.type, 'icon', typeConf.default_icon || 'bell');
    var icon     = ICONS[iconKey] || DEFAULT_ICON;
    var ts       = n.created_at ? new Date(n.created_at).toLocaleString() : '';
    var classes  = 'nc-row';
    if (!n.read) classes += ' nc-row-unread';
    if (n.dismissed) classes += ' nc-row-dismissed';

    var actionBtns = inDrawer
      ? '<div class="nc-row-actions">'
        + (!n.read ? '<button class="nc-btn-ghost" onclick="event.stopPropagation();notifPanelMarkRead(\'' + n.id + '\')">&#10003;</button>' : '')
        + '<button class="nc-btn-ghost" onclick="event.stopPropagation();notifPanelDismiss(\'' + n.id + '\')">&#10005;</button>'
        + '</div>'
      : '';

    return '<div class="' + classes + '" onclick="notifPanelRowClick(\'' + n.id + '\',\'' + (n.inquiry_id || '') + '\')">'
      + '<div class="nc-row-icon">' + icon + '</div>'
      + '<div class="nc-row-body">'
        + '<div class="nc-row-title">' + (n.title || '') + '</div>'
        + (n.body ? '<div class="nc-row-meta">' + n.body + '</div>' : '')
        + '<div class="nc-row-meta">' + ts + '</div>'
      + '</div>'
      + actionBtns
    + '</div>';
  }

  // ── Page render ────────────────────────────────────────────────────────────
  function renderPageFilters() {
    var el = document.getElementById('nc-page-filters');
    if (!el) return;
    var filters = [
      { id: 'all',    label: 'All' },
      { id: 'unread', label: 'Unread' },
      { id: 'read',   label: 'Read' },
    ];
    el.innerHTML = filters.map(function (f) {
      var cls = 'nc-chip' + (f.id === _pageFilter ? ' nc-chip-active' : '');
      return '<button class="' + cls + '" onclick="notifPanelSetFilter(\'' + f.id + '\')">' + f.label + '</button>';
    }).join('');
  }

  function renderPageList() {
    var el = document.getElementById('nc-page-list');
    if (!el) return;

    var filter = _pageFilter;
    var url    = '/api/notifications?limit=' + (_pageOffset + _pageLimit) + '&offset=0';
    if (filter === 'unread') url += '&unread=true';
    if (filter === 'read')   url += '&read=true';

    apiFetch(url).then(function (d) {
      if (!d || !d.ok) { el.innerHTML = '<div class="nc-empty">Failed to load.</div>'; return; }
      var notifs = d.notifications || [];
      el.innerHTML = notifs.length
        ? notifs.map(function (n) { return renderRow(n, false); }).join('')
        : '<div class="nc-empty">No notifications.</div>';
      var moreBtn = document.getElementById('nc-load-more-btn');
      if (moreBtn) moreBtn.style.display = notifs.length >= _pageOffset + _pageLimit ? '' : 'none';
    }).catch(function () {
      el.innerHTML = '<div class="nc-empty">Error loading notifications.</div>';
    });
  }

  // ── Settings panel ─────────────────────────────────────────────────────────
  function renderSettings() {
    var el = document.getElementById('nc-settings-list');
    if (!el) return;
    if (!_types.length) {
      el.innerHTML = '<div class="nc-empty">No notification types configured.</div>';
      return;
    }
    el.innerHTML = _types.map(function (t) {
      var sound   = getTypeSetting(t.id, 'sound', 'ding');
      var muted   = getTypeSetting(t.id, 'muted', false);
      var iconKey = getTypeSetting(t.id, 'icon', t.default_icon || 'bell');

      var soundOpts = ['chime', 'alert', 'ding', 'whoosh', 'none'].map(function (s) {
        return '<option value="' + s + '"' + (s === sound ? ' selected' : '') + '>' + s + '</option>';
      }).join('');

      var iconOpts = Object.keys(ICONS).map(function (k) {
        return '<option value="' + k + '"' + (k === iconKey ? ' selected' : '') + '>' + ICONS[k] + ' ' + k + '</option>';
      }).join('');

      return '<div class="nc-settings-row">'
        + '<div class="nc-settings-label">' + (t.label || t.id) + '</div>'
        + '<select class="nc-settings-select" onchange="notifPanelSetIcon(\'' + t.id + '\',this.value)">' + iconOpts + '</select>'
        + '<select class="nc-settings-select" onchange="notifPanelSetSound(\'' + t.id + '\',this.value)">' + soundOpts + '</select>'
        + '<button class="nc-btn-ghost" onclick="notifPanelPreviewSound(\'' + t.id + '\')" title="Preview">&#9654;</button>'
        + '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">'
          + '<input type="checkbox"' + (muted ? ' checked' : '') + ' onchange="notifPanelSetMute(\'' + t.id + '\',this.checked)"> Mute'
        + '</label>'
      + '</div>';
    }).join('');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // ── Auto-close wiring ─────────────────────────────────────────────────────
  // Drawer must close on SPA nav, Escape, and outside-click. Overlay already
  // handles outside-click (onclick → notifPanelCloseDrawer). The other two
  // are wired here. Wiring runs unconditionally (not behind the flag gate)
  // so the handlers exist whenever the drawer can be opened.
  var _autoCloseWired = false;
  function wireAutoClose() {
    if (_autoCloseWired) return;
    _autoCloseWired = true;
    try {
      var origShowPage = window.showPage;
      window.showPage = function () {
        if (_drawerOpen) closeDrawer();
        if (typeof origShowPage === 'function') {
          return origShowPage.apply(this, arguments);
        }
      };
    } catch (_) {}
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _drawerOpen) closeDrawer();
    });
  }

  // Wire on DOM ready so window.showPage exists by the time we wrap it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAutoClose);
  } else {
    wireAutoClose();
  }

  window.notifPanelInit = async function () {
    if (_inited) return;
    _inited = true;
    loadSettings();

    try {
      if (!window.flags) return;
      await window.flags.load();
      if (!window.flags.isEnabled('notifications_center')) return;
    } catch (_) { return; }

    try {
      var td = await fetch('/api/notifications/types').then(function (r) { return r.json(); });
      _types = (td && td.types) || [];
    } catch (_) { _types = []; }

    showBell();
    showNavItem();

    try {
      var cd = await fetch('/api/notifications/counts').then(function (r) { return r.json(); });
      if (cd && cd.ok) { _unreadCount = cd.unread_count || 0; updateBadge(_unreadCount); }
    } catch (_) {}

    _pollTimer = setInterval(poll, 30000);
  };

  window.notifPanelToggleDrawer = function () {
    if (_drawerOpen) closeDrawer(); else openDrawer();
  };

  window.notifPanelCloseDrawer = function () { closeDrawer(); };

  window.notifPanelMarkAllRead = function () {
    _unreadCount = 0;
    updateBadge(0);
    var badge = document.getElementById('nc-bell-badge');
    if (badge) badge.style.display = 'none';
    apiFetch('/api/notifications/mark-all-read', { method: 'POST' }).catch(function () {});
    _notifications.forEach(function (n) { n.read = true; });
    if (_drawerOpen) renderDrawerList();
  };

  window.notifPanelRenderPage = function () {
    renderPageFilters();
    renderPageList();
  };

  window.notifPanelOpenSettings = function () {
    var panel = document.getElementById('nc-settings-panel');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
      renderSettings();
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  };

  window.notifPanelRowClick = function (id, inquiryId) {
    window.notifPanelMarkRead(id);
    if (inquiryId && typeof showPage === 'function') {
      showPage('inquiries');
      if (typeof openInquiry === 'function') openInquiry(inquiryId);
      closeDrawer();
    }
  };

  window.notifPanelMarkRead = function (id) {
    var n = _notifications.find(function (x) { return x.id === id; });
    if (!n) return;
    n.read = true;
    if (_unreadCount > 0) { _unreadCount--; updateBadge(_unreadCount); }
    apiFetch('/api/notifications/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read' }),
    }).catch(function () {});
    if (_drawerOpen) renderDrawerList();
  };

  window.notifPanelDismiss = function (id) {
    var n = _notifications.find(function (x) { return x.id === id; });
    if (!n) return;
    if (!n.read) { n.read = true; if (_unreadCount > 0) { _unreadCount--; updateBadge(_unreadCount); } }
    n.dismissed = true;
    apiFetch('/api/notifications/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    }).catch(function () {});
    if (_drawerOpen) renderDrawerList();
  };

  window.notifPanelSetSound = function (typeId, sound) { setTypeSetting(typeId, 'sound', sound); };
  window.notifPanelSetMute  = function (typeId, muted)  { setTypeSetting(typeId, 'muted', muted); };
  window.notifPanelSetIcon  = function (typeId, icon)   { setTypeSetting(typeId, 'icon', icon); };

  window.notifPanelPreviewSound = function (typeId) {
    var muted = getTypeSetting(typeId, 'muted', false);
    if (muted) return;
    var sound = getTypeSetting(typeId, 'sound', 'ding');
    playSound(sound, 0.6);
  };

  window.notifPanelSetFilter = function (filter) {
    _pageFilter  = filter;
    _pageOffset  = 0;
    renderPageFilters();
    renderPageList();
  };

  window.notifPanelLoadMore = function () {
    _pageOffset += _pageLimit;
    renderPageList();
  };

  window.notifPanelGoToInquiry = function (inquiryId) {
    if (typeof showPage === 'function') showPage('inquiries');
    if (typeof openInquiry === 'function') openInquiry(inquiryId);
  };

})();
