'use strict';
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal browser environment ───────────────────────────────────────────
const _els = {};
function el(id) {
  if (!_els[id]) {
    _els[id] = {
      id,
      _style: {},
      _classes: new Set(),
      _html: '',
      _text: '',
      get style() { return this._style; },
      get className() { return [...this._classes].join(' '); },
      set className(v) { this._classes = new Set(v.split(' ').filter(Boolean)); },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; },
      classList: {
        _el: null,
        add(c)    { _els[id]._classes.add(c); },
        remove(c) { _els[id]._classes.delete(c); },
        contains(c) { return _els[id]._classes.has(c); },
        toggle(c, f) {
          if (f === undefined) f = !_els[id]._classes.has(c);
          if (f) _els[id]._classes.add(c); else _els[id]._classes.delete(c);
        },
      },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getAttribute() { return null; },
      setAttribute() {},
    };
  }
  return _els[id];
}

const _ls = {};
global.window   = global;
global.document = {
  readyState: 'complete',
  getElementById(id) { return el(id); },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement(tag) {
    return {
      tag, _classes: new Set(), _style: {},
      get style() { return this._style; },
      className: '',
      innerHTML: '', textContent: '', title: '',
      appendChild() {},
      addEventListener() {},
      click() {},
      setAttribute() {},
    };
  },
  body: { appendChild() {}, removeChild() {} },
};
global.localStorage = {
  getItem(k)    { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem(k, v) { _ls[k] = String(v); },
  removeItem(k) { delete _ls[k]; },
};
global.requestAnimationFrame = (fn) => { fn(0); return 0; };

// Fake fetch: flag enabled, no notifications
global.fetch = async (url) => {
  if (url && url.includes('/api/flags/')) {
    return { ok: true, json: async () => ({ enabled: true }) };
  }
  if (url && url.includes('/api/notifications/list')) {
    return { ok: true, json: async () => ({ ok: true, notifications: [], unread_count: 0, has_more: false }) };
  }
  if (url && url.includes('/api/notifications/types')) {
    return { ok: true, json: async () => ({ ok: true, types: [
      { id: 'follow_up_due', label: 'Follow-up Due', icon: '⏰' },
      { id: 'deposit_overdue', label: 'Deposit Overdue', icon: '💵' },
    ]}) };
  }
  if (url && url.includes('/api/notifications/counts')) {
    return { ok: true, json: async () => ({ ok: true, unread_count: 0, by_type: {} }) };
  }
  if (url && url.includes('/api/notifications/')) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return { ok: true, json: async () => ({}) };
};

// Web Audio API stub
global.AudioContext = function () {
  return {
    state: 'running',
    currentTime: 0,
    createOscillator() {
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
    destination: {},
  };
};

// Load the module
require('./notifications-panel.js');

// ── Tests ─────────────────────────────────────────────────────────────────
describe('notifications-panel exports', () => {
  it('exposes notifPanelInit on window', () => {
    assert.equal(typeof window.notifPanelInit, 'function');
  });

  it('exposes notifPanelToggleDrawer on window', () => {
    assert.equal(typeof window.notifPanelToggleDrawer, 'function');
  });

  it('exposes notifPanelCloseDrawer on window', () => {
    assert.equal(typeof window.notifPanelCloseDrawer, 'function');
  });

  it('exposes notifPanelMarkAllRead on window', () => {
    assert.equal(typeof window.notifPanelMarkAllRead, 'function');
  });

  it('exposes notifPanelRenderPage on window', () => {
    assert.equal(typeof window.notifPanelRenderPage, 'function');
  });

  it('exposes notifPanelOpenSettings on window', () => {
    assert.equal(typeof window.notifPanelOpenSettings, 'function');
  });

  it('exposes notifPanelMarkRead on window', () => {
    assert.equal(typeof window.notifPanelMarkRead, 'function');
  });

  it('exposes notifPanelDismiss on window', () => {
    assert.equal(typeof window.notifPanelDismiss, 'function');
  });

  it('exposes notifPanelSetSound on window', () => {
    assert.equal(typeof window.notifPanelSetSound, 'function');
  });

  it('exposes notifPanelSetMute on window', () => {
    assert.equal(typeof window.notifPanelSetMute, 'function');
  });

  it('exposes notifPanelSetIcon on window', () => {
    assert.equal(typeof window.notifPanelSetIcon, 'function');
  });

  it('exposes notifPanelPreviewSound on window', () => {
    assert.equal(typeof window.notifPanelPreviewSound, 'function');
  });

  it('exposes notifPanelSetFilter on window', () => {
    assert.equal(typeof window.notifPanelSetFilter, 'function');
  });

  it('exposes notifPanelLoadMore on window', () => {
    assert.equal(typeof window.notifPanelLoadMore, 'function');
  });
});

describe('bell badge visibility', () => {
  it('bell badge is hidden when unread count is 0', () => {
    const badge = el('nc-bell-badge');
    assert.ok(
      badge.style.display === 'none' || badge.style.display === '' || !badge._classes.has('nc-bell-badge-visible'),
      'badge should not be visible at zero'
    );
  });
});

describe('drawer open / close / toggle', () => {
  beforeEach(() => {
    // reset drawer state
    const drawer  = el('nc-drawer');
    const overlay = el('nc-drawer-overlay');
    drawer._classes.delete('nc-drawer-open');
    overlay.style.display = 'none';
  });

  it('openDrawer adds nc-drawer-open class', () => {
    window.notifPanelToggleDrawer();
    const drawer = el('nc-drawer');
    assert.ok(drawer._classes.has('nc-drawer-open'), 'drawer should have nc-drawer-open');
  });

  it('closeDrawer removes nc-drawer-open class', () => {
    window.notifPanelToggleDrawer(); // open
    window.notifPanelCloseDrawer();
    const drawer = el('nc-drawer');
    assert.ok(!drawer._classes.has('nc-drawer-open'), 'drawer should not have nc-drawer-open after close');
  });

  it('toggle twice returns to closed state', () => {
    window.notifPanelToggleDrawer();
    window.notifPanelToggleDrawer();
    const drawer = el('nc-drawer');
    assert.ok(!drawer._classes.has('nc-drawer-open'), 'drawer should be closed after two toggles');
  });
});

describe('sound settings persistence', () => {
  beforeEach(() => {
    delete _ls['nc_type_settings'];
  });

  it('setSound persists to localStorage', () => {
    window.notifPanelSetSound('follow_up_due', 'chime');
    const raw = _ls['nc_type_settings'];
    assert.ok(raw, 'nc_type_settings should be set');
    const settings = JSON.parse(raw);
    assert.equal(settings.follow_up_due && settings.follow_up_due.sound, 'chime');
  });

  it('setMute persists to localStorage', () => {
    window.notifPanelSetMute('deposit_overdue', true);
    const raw = _ls['nc_type_settings'];
    assert.ok(raw, 'nc_type_settings should be set');
    const settings = JSON.parse(raw);
    assert.equal(settings.deposit_overdue && settings.deposit_overdue.muted, true);
  });

  it('setIcon persists to localStorage', () => {
    window.notifPanelSetIcon('follow_up_due', '⏰');
    const raw = _ls['nc_type_settings'];
    assert.ok(raw, 'nc_type_settings should be set');
    const settings = JSON.parse(raw);
    assert.equal(settings.follow_up_due && settings.follow_up_due.icon, '⏰');
  });

  it('multiple settings for different types coexist', () => {
    window.notifPanelSetSound('follow_up_due', 'chime');
    window.notifPanelSetMute('deposit_overdue', true);
    const settings = JSON.parse(_ls['nc_type_settings'] || '{}');
    assert.equal(settings.follow_up_due && settings.follow_up_due.sound, 'chime');
    assert.equal(settings.deposit_overdue && settings.deposit_overdue.muted, true);
  });
});

describe('preview sound', () => {
  it('notifPanelPreviewSound does not throw for known type', () => {
    assert.doesNotThrow(() => window.notifPanelPreviewSound('follow_up_due'));
  });

  it('notifPanelPreviewSound does not throw for unknown type', () => {
    assert.doesNotThrow(() => window.notifPanelPreviewSound('nonexistent_type'));
  });

  it('notifPanelPreviewSound does not throw when muted', () => {
    window.notifPanelSetMute('follow_up_due', true);
    assert.doesNotThrow(() => window.notifPanelPreviewSound('follow_up_due'));
  });
});

describe('filter and load more', () => {
  it('setFilter does not throw', () => {
    assert.doesNotThrow(() => window.notifPanelSetFilter('all'));
    assert.doesNotThrow(() => window.notifPanelSetFilter('follow_up_due'));
    assert.doesNotThrow(() => window.notifPanelSetFilter('unread'));
  });

  it('loadMore does not throw', () => {
    assert.doesNotThrow(() => window.notifPanelLoadMore());
  });
});

describe('markRead / dismiss no-ops for unknown ids', () => {
  it('markRead does not throw for unknown id', () => {
    assert.doesNotThrow(() => window.notifPanelMarkRead('fake-id-999'));
  });

  it('dismiss does not throw for unknown id', () => {
    assert.doesNotThrow(() => window.notifPanelDismiss('fake-id-999'));
  });
});

describe('renderPage no-ops gracefully', () => {
  it('notifPanelRenderPage does not throw', () => {
    assert.doesNotThrow(() => window.notifPanelRenderPage());
  });

  it('notifPanelOpenSettings does not throw', () => {
    assert.doesNotThrow(() => window.notifPanelOpenSettings());
  });

  it('notifPanelMarkAllRead does not throw', () => {
    assert.doesNotThrow(() => window.notifPanelMarkAllRead());
  });
});
