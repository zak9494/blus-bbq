/* ===== Maps: Mapbox Distance Client Module
   Exposes: window.mapboxDistance = { fetch, mapsViewUrl, fmtChip }
   fetch(origin, destination, departAtIso) → Promise<{ miles, freeFlowMin, trafficMin } | null>
   origin is accepted for API compatibility but routing always uses server-side shop address.
   Results cached by destination + 15-min-bucketed departAt.
   ===== */
(function () {
  'use strict';

  var _cache = {};
  // Updated from first successful API response (server resolves BLUS_BBQ_ORIGIN_ADDRESS)
  var _shopAddr = '17630 Preston Rd, Dallas TX 75252';

  function bucket15(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
      return d.toISOString();
    } catch (_) { return isoStr; }
  }

  async function fetchDistance(origin, destination, departAtIso) {
    if (!destination) return null;
    var key = destination + '|' + bucket15(departAtIso || '');
    if (_cache[key]) return _cache[key];

    var url = '/api/maps/distance?destination=' + encodeURIComponent(destination);
    if (departAtIso) url += '&departAt=' + encodeURIComponent(departAtIso);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;

    try {
      var opts = { cache: 'no-store' };
      if (controller) opts.signal = controller.signal;
      var r = await fetch(url, opts);
      if (timer) clearTimeout(timer);
      var j = await r.json();
      if (!j.ok) return null;
      if (j.origin) _shopAddr = j.origin;
      _cache[key] = j;
      return j;
    } catch (_) {
      if (timer) clearTimeout(timer);
      return null;
    }
  }

  function mapsViewUrl(destination) {
    return 'https://www.google.com/maps/dir/?api=1'
      + '&origin=' + encodeURIComponent(_shopAddr)
      + '&destination=' + encodeURIComponent(destination);
  }

  // Returns "12.4 mi · 18 / 27 min" or null
  function fmtChip(result) {
    if (!result) return null;
    return result.miles.toFixed(1) + ' mi \u00b7 ' + result.freeFlowMin + ' / ' + result.trafficMin + ' min';
  }

  window.mapboxDistance = {
    fetch: fetchDistance,
    mapsViewUrl: mapsViewUrl,
    fmtChip: fmtChip,
  };
})();
