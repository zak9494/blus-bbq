/* ===== MODULE: NAV V2
   Replaces hamburger+sidebar with bottom tab bar (mobile) and
   collapsed/expanded sidebar (tablet/desktop).
   Activated when nav_v2 feature flag is ON.
   Exports: window.navV2.init(), navV2.navigate(page), navV2.toggleSidebar()
   ===== */
(function () {
  'use strict';

  /* Pages -> primary tab */
  var TAB_MAP = {
    inquiries: 'inquiries', pipeline: 'pipeline', calendar: 'calendar',
    today: 'today', settings: 'settings',
    quotes: 'settings', scheduled: 'settings', ai: 'settings',
    flags: 'settings', history: 'settings', invoices: 'settings', outbound: 'settings',
  };

  var _active = false;

  function navigate(page) {
    if (page === 'calendar') {
      window.showPage('calendar');
      if (typeof calInit === 'function') calInit();
    } else if (page === 'today') {
      window.showPage('today');
      if (window.flags && window.flags.isEnabled('event_day_view') &&
          typeof loadEventDayView === 'function') loadEventDayView();
    } else if (page === 'settings') {
      window.showPage('settings');
      _syncSettings();
    } else {
      window.showPage(page);
    }
    _updateTabs(page);
  }

  function toggleSidebar() {
    var sidebar = document.getElementById('nav-v2-sidebar');
    if (!sidebar) return;
    var expanded = sidebar.classList.toggle('expanded');
    document.querySelector('.app').classList.toggle('nav2-sidebar-expanded', expanded);
    try { localStorage.setItem('sidebar_expanded', expanded ? 'true' : 'false'); } catch (e) {}
    var btn = sidebar.querySelector('.nav2-sidebar-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(expanded));
  }

  function _updateTabs(page) {
    var tab = TAB_MAP[page] || 'pipeline';
    document.querySelectorAll('.nav2-tab, .nav2-item').forEach(function (el) {
      var active = el.getAttribute('data-page') === tab;
      el.classList.toggle('active', active);
      el.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function _syncSettings() {
    var sub = document.getElementById('settings-theme-sub');
    if (sub) sub.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Dark mode' : 'Light mode';
    if (typeof checkGmailStatus === 'function') checkGmailStatus();
  }

  function _activate() {
    _active = true;

    ['nav-v2-topbar', 'nav-v2-sidebar', 'nav-v2-tabbar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = '';
    });

    document.querySelector('.app').classList.add('nav-v2-active');

    var bell = document.getElementById('nav2-bell-btn');
    if (bell) bell.style.display = (window.flags && window.flags.isEnabled('notifications_center')) ? '' : 'none';

    var placeholder = document.getElementById('today-placeholder');
    var realContent = document.getElementById('today-real-content');
    var eventDay = window.flags && window.flags.isEnabled('event_day_view');
    if (placeholder) placeholder.style.display = eventDay ? 'none' : '';
    if (realContent) realContent.style.display = eventDay ? '' : 'none';

    var expanded = false;
    try { expanded = localStorage.getItem('sidebar_expanded') === 'true'; } catch (e) {}
    if (expanded) {
      var sidebar = document.getElementById('nav-v2-sidebar');
      if (sidebar) {
        sidebar.classList.add('expanded');
        document.querySelector('.app').classList.add('nav2-sidebar-expanded');
        var btn = sidebar.querySelector('.nav2-sidebar-toggle');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    }

    _updateTabs('pipeline');
    _syncSettings();

    if (!window._navV2_origShowPage) {
      window._navV2_origShowPage = window.showPage;
      window.showPage = function (page) {
        window._navV2_origShowPage.call(window, page);
        if (_active) _updateTabs(page);
      };
    }
  }

  function init() {
    if (!window.flags) return;
    return window.flags.load().then(function (map) {
      if (map && map.nav_v2) _activate();
    }).catch(function () {});
  }

  window.navV2 = { init: init, navigate: navigate, toggleSidebar: toggleSidebar, updateActiveTabs: _updateTabs };
})();
