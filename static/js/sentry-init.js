/* static/js/sentry-init.js
 * Client-side Sentry init. Loads the official Sentry browser bundle from
 * the Sentry CDN only when:
 *   - The `sentry_enabled` flag is ON in /api/flags, AND
 *   - SENTRY_DSN is set in Vercel env vars (so /api/sentry-config returns dsn).
 *
 * When either is absent, this script is a near-zero-cost no-op (one
 * fetch to /api/sentry-config that returns { enabled: false } and is
 * cached for 60 seconds).
 *
 * Loaded EARLY in index.html so we capture errors that happen during
 * subsequent script parsing.
 */
(function () {
  'use strict';

  // Capture page + click breadcrumbs even before Sentry is loaded so they
  // are available once init completes. We push to a queue and Sentry's
  // global mechanism picks them up via window-level error listeners.
  var pendingBreadcrumbs = [];
  function rememberBreadcrumb(category, message, data) {
    pendingBreadcrumbs.push({
      category: category,
      message: message,
      data: data || {},
      timestamp: Date.now() / 1000,
    });
    if (pendingBreadcrumbs.length > 50) pendingBreadcrumbs.shift();
  }

  // Page-load + nav breadcrumb
  rememberBreadcrumb('navigation', 'page_load', {
    path: location.pathname,
    referrer: document.referrer || null,
  });

  // Click breadcrumbs — coarse selector (data-page, id, or tag)
  document.addEventListener(
    'click',
    function (ev) {
      var t = ev.target;
      if (!t || !t.tagName) return;
      var sel = t.tagName.toLowerCase();
      if (t.id) sel += '#' + t.id;
      else if (t.dataset && t.dataset.page) sel += '[data-page=' + t.dataset.page + ']';
      else if (t.className && typeof t.className === 'string') {
        sel += '.' + t.className.split(/\s+/).slice(0, 2).join('.');
      }
      rememberBreadcrumb('ui.click', sel);
    },
    true
  );

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function init() {
    return fetch('/api/sentry-config', { credentials: 'omit' })
      .then(function (r) {
        return r.ok ? r.json() : { enabled: false };
      })
      .then(function (cfg) {
        if (!cfg || !cfg.enabled || !cfg.dsn) return null;

        var SENTRY_VERSION = '8.40.0';
        var bundle =
          'https://browser.sentry-cdn.com/' + SENTRY_VERSION + '/bundle.tracing.min.js';
        return loadScript(bundle).then(function () {
          if (!window.Sentry) return null;
          window.Sentry.init({
            dsn: cfg.dsn,
            release: cfg.release,
            environment: cfg.environment,
            tracesSampleRate: 0,
            initialScope: {
              tags: {
                page: location.pathname,
              },
            },
            beforeSend: function (event) {
              event.breadcrumbs = (event.breadcrumbs || []).concat(pendingBreadcrumbs);
              return event;
            },
          });
          window.__sentry_initialized = true;
          return window.Sentry;
        });
      })
      .catch(function () {
        // Network failures must not break the page.
        return null;
      });
  }

  // Expose for tests + manual diagnostics.
  window.__sentryInit = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
