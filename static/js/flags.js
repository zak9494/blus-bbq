/* ===== MODULE: FEATURE FLAGS CLIENT
   Fetches /api/flags on dashboard load, caches for 60s.
   Exposes:
     window.flags.load()         — async; call once on init; returns flag map
     window.flags.isEnabled(name) — sync; returns bool from cache (false if not loaded)
     window.flags.reload()        — force cache bust + reload
   ===== */
(function () {
  'use strict';

  var _cache     = null;   // { flagName: boolean, ... }
  var _cacheTime = 0;
  var _loading   = null;   // in-flight Promise
  var TTL        = 60 * 1000;

  function buildMap(flags) {
    var map = {};
    (flags || []).forEach(function (f) { map[f.name] = !!f.enabled; });
    return map;
  }

  async function load() {
    if (_cache && (Date.now() - _cacheTime) < TTL) return _cache;
    if (_loading) return _loading;
    _loading = fetch('/api/flags')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _cache     = buildMap(d.flags);
        _cacheTime = Date.now();
        _loading   = null;
        return _cache;
      })
      .catch(function () {
        _loading = null;
        if (!_cache) _cache = {};
        return _cache;
      });
    return _loading;
  }

  function isEnabled(name) {
    if (!_cache) return false;
    return !!_cache[name];
  }

  function reload() {
    _cache     = null;
    _cacheTime = 0;
    return load();
  }

  window.flags = { load: load, isEnabled: isEnabled, reload: reload };
})();
