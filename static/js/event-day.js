/* ===== Event-Day Operations View (Group 10) ===================================
   Mobile-first field card deck for today's booked events.
   Exports: window.loadEventDayView, window.edMarkStatus
   ============================================================================= */
(function () {
  'use strict';

  var _events = [];

  function secret() {
    return typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '';
  }

  function mapsUrl(address) {
    var enc = encodeURIComponent(address);
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    return isIOS
      ? 'maps://maps.apple.com/?daddr=' + enc
      : 'https://www.google.com/maps/dir/?api=1&destination=' + enc;
  }

  function fmt12h(t) {
    if (!t) return null;
    var parts = t.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ampm;
  }

  function menuItems(inq) {
    var items = [];
    if (inq.quote && Array.isArray(inq.quote.line_items)) {
      inq.quote.line_items.forEach(function (li) {
        if (li.name) items.push(li.name);
      });
    }
    return items;
  }

  function h(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderCard(inq) {
    var time12   = fmt12h(inq.event_time);
    var statusCls = 'ed-status-' + (inq.status || 'booked');
    var statusLabel = inq.status === 'in_progress' ? 'In Progress'
                    : inq.status === 'completed'   ? 'Completed'
                    : 'Booked';

    var addressHtml = '';
    if (inq.delivery_address) {
      var mUrl = mapsUrl(inq.delivery_address);
      var mapsEnabled = window.flags && window.flags.isEnabled('maps_v1');
      var distExtra = '';
      if (mapsEnabled) {
        var hasOrigin = !!(window.shopOriginAddress && String(window.shopOriginAddress).trim());
        if (hasOrigin) {
          var gmUrl = window.mapboxDistance
            ? window.mapboxDistance.mapsViewUrl(inq.delivery_address)
            : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(inq.delivery_address);
          distExtra = ' <a class="maps-view-btn" href="' + h(gmUrl) + '" target="_blank" rel="noopener">View Map</a>'
            + '<span class="maps-dist-chip maps-loading" id="ed-dist-' + h(inq.threadId) + '">\u2026</span>';
        } else {
          distExtra = ' <span class="maps-empty-notice" data-testid="maps-empty-notice">'
            + 'Set your shop address in '
            + '<a href="#" class="maps-empty-link" onclick="window.openShopAddressSetting&&window.openShopAddressSetting();return false;">Settings &rarr; Shop Info</a>'
            + ' to enable maps &amp; drive times.</span>';
        }
      }
      addressHtml = '<div class="ed-info-row">'
        + '<span class="ed-info-label">Address</span>'
        + '<span class="ed-address-content">'
        + '<a class="ed-address-link" href="' + h(mUrl) + '" target="_blank" rel="noopener">'
        + h(inq.delivery_address) + '</a>'
        + distExtra
        + '</span></div>';
    }

    var guestHtml = inq.guest_count
      ? '<div class="ed-info-row"><span class="ed-info-label">Guests</span>' + h(inq.guest_count) + '</div>'
      : '';

    var menus = menuItems(inq);
    var menuHtml = '';
    if (menus.length) {
      menuHtml = '<div class="ed-info-row"><span class="ed-info-label">Menu</span>'
        + '<div class="ed-menu-list">'
        + menus.map(function (m) { return '<span class="ed-menu-chip">' + h(m) + '</span>'; }).join('')
        + '</div></div>';
    }

    var notesHtml = inq.special_requests
      ? '<div class="ed-notes">&#128204; ' + h(inq.special_requests) + '</div>'
      : '';

    var phoneHtml = '';
    if (inq.customer_phone) {
      var tel = inq.customer_phone.replace(/\D/g, '');
      phoneHtml = '<div class="ed-phone-row">'
        + '<a class="ed-phone-btn" href="tel:+1' + tel + '">&#128222; Call</a>'
        + '<a class="ed-phone-btn" href="sms:+1' + tel + '">&#128172; Text</a>'
        + '</div>';
    }

    var btnInProgress = inq.status === 'booked'
      ? '<button class="ed-action-btn ed-action-primary" onclick="edMarkStatus(\'' + h(inq.threadId) + '\',\'in_progress\',this)">Mark In Progress</button>'
      : '';
    var btnCompleted = inq.status !== 'completed'
      ? '<button class="ed-action-btn ed-action-secondary" onclick="edMarkStatus(\'' + h(inq.threadId) + '\',\'completed\',this)">Mark Completed</button>'
      : '<button class="ed-action-btn ed-action-secondary" disabled>Completed</button>';

    return '<div class="ed-card" data-thread="' + h(inq.threadId) + '">'
      + '<div class="ed-card-header">'
      +   '<span class="ed-card-name">' + h(inq.customer_name) + '</span>'
      +   (time12 ? '<span class="ed-card-time">' + h(time12) + '</span>' : '')
      + '</div>'
      + '<span class="ed-status-badge ' + h(statusCls) + '">' + statusLabel + '</span>'
      + addressHtml
      + guestHtml
      + menuHtml
      + notesHtml
      + phoneHtml
      + '<div class="ed-action-row">' + btnInProgress + btnCompleted + '</div>'
      + '</div>';
  }

  window.edMarkStatus = async function (threadId, newStatus, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      var r = await fetch('/api/inquiries/save?secret=' + encodeURIComponent(secret()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadId,
          status: newStatus,
          history_entry: { action: 'status_changed_to_' + newStatus, actor: 'user' },
        }),
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'save failed');
      var idx = _events.findIndex(function (e) { return e.threadId === threadId; });
      if (idx !== -1) { _events[idx].status = newStatus; }
      _renderCards();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      console.error('edMarkStatus error', err);
    }
  };

  function _fetchDistances() {
    if (!window.mapboxDistance || !window.flags || !window.flags.isEnabled('maps_v1')) return;
    _events.forEach(function (inq) {
      if (!inq.delivery_address) return;
      var departAt = (inq.event_date && inq.event_time)
        ? inq.event_date + 'T' + inq.event_time + ':00-05:00'
        : null;
      window.mapboxDistance.fetch('default', inq.delivery_address, departAt)
        .then(function (result) {
          var chip = document.getElementById('ed-dist-' + inq.threadId);
          if (!chip) return;
          if (result) {
            chip.textContent = window.mapboxDistance.fmtChip(result);
            chip.classList.remove('maps-loading');
            chip.title = 'Free-flow: ' + result.freeFlowMin + ' min \u00b7 With traffic: ' + result.trafficMin + ' min';
            var viewBtn = chip.previousElementSibling;
            if (viewBtn && viewBtn.classList.contains('maps-view-btn')) {
              viewBtn.href = window.mapboxDistance.mapsViewUrl(inq.delivery_address);
            }
          } else {
            chip.style.display = 'none';
          }
        });
    });
  }

  function _renderCards() {
    var el = document.getElementById('ed-cards');
    if (!el) return;
    if (!_events.length) {
      el.innerHTML = '<div class="ed-empty"><span class="ed-empty-icon">&#127814;</span>No events scheduled for today.</div>';
      return;
    }
    el.innerHTML = _events.map(renderCard).join('');
    _fetchDistances();
  }

  async function load() {
    var loading = document.getElementById('ed-loading');
    var cards   = document.getElementById('ed-cards');
    var label   = document.getElementById('ed-date-label');
    if (loading) loading.style.display = 'flex';
    if (cards)   cards.innerHTML = '';

    try {
      var r = await fetch('/api/events/today?secret=' + encodeURIComponent(secret()));
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'load failed');
      if (label) label.textContent = j.date ? 'Events for ' + j.date : '';
      _events = j.events || [];
    } catch (err) {
      _events = [];
      if (cards) cards.innerHTML = '<div class="ed-empty"><span class="ed-empty-icon">&#9888;&#65039;</span>Could not load events.</div>';
    } finally {
      if (loading) loading.style.display = 'none';
    }
    _renderCards();
  }

  window.loadEventDayView = load;
})();
