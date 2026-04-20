/* ===== MODULE: QUOTE REVISION FLOW (C19)
   File: static/js/quote-revise.js
   Loaded by: index.html <script src="/static/js/quote-revise.js">
   Depends on: window.MENU, window.selectedItems, window.buildMenuPicker, window.updatePreview,
               window.showPage, window.currentQuoteNumber, window.qbTaxExempt
   Exposes: window.quoteReviseOpen(inq)
   Copies an existing inquiry quote into the Quote Builder for revision.
   ===== */
(function () {
  'use strict';

  // Build a flat name → MENU item lookup (normalized)
  function buildMenuLookup() {
    var lookup = {};
    if (typeof MENU === 'undefined') return lookup;
    Object.keys(MENU).forEach(function (cat) {
      MENU[cat].forEach(function (item) {
        var key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        lookup[key] = item;
      });
    });
    return lookup;
  }

  function normName(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Show/hide the revision banner in the Quote Builder topbar
  function showRevisionBanner(name, threadId) {
    var existing = document.getElementById('qb-revision-banner');
    if (existing) existing.remove();
    if (!name) return;
    var banner = document.createElement('div');
    banner.id = 'qb-revision-banner';
    banner.style.cssText = 'background:var(--amber-bg);border-bottom:1px solid var(--amber-border);padding:8px 20px;font-size:12px;color:var(--amber);display:flex;align-items:center;gap:10px;flex-shrink:0';
    banner.innerHTML = '📋 <strong>Revising quote for ' + escHtml(name) + '</strong>'
      + (threadId ? ' <span style="color:var(--text3);font-size:11px">· from inquiry ' + escHtml(threadId.slice(0, 12)) + '…</span>' : '')
      + ' <button onclick="quoteReviseClose()" style="margin-left:auto;background:none;border:none;color:var(--amber);cursor:pointer;font-size:12px;font-weight:600">✕ Clear</button>';
    // Insert after topbar of quotes page
    var quotesPage = document.getElementById('page-quotes');
    if (quotesPage) {
      var topbar = quotesPage.querySelector('.topbar');
      if (topbar && topbar.nextSibling) {
        quotesPage.insertBefore(banner, topbar.nextSibling);
      } else if (topbar) {
        topbar.insertAdjacentElement('afterend', banner);
      } else {
        quotesPage.prepend(banner);
      }
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.quoteReviseClose = function () {
    var banner = document.getElementById('qb-revision-banner');
    if (banner) banner.remove();
  };

  window.quoteReviseOpen = function (inq) {
    if (!inq) return;
    var q = inq.quote;
    var ef = inq.extracted_fields || {};

    // Navigate to Quote Builder
    showPage('quotes');

    // Increment quote number with 'R' suffix to mark revision
    if (typeof currentQuoteNumber !== 'undefined') {
      currentQuoteNumber++;
      var qnEl = document.getElementById('quote-number');
      if (qnEl) qnEl.textContent = '#QT-' + currentQuoteNumber + 'R';
    }

    // Pre-fill customer/event fields
    var setVal = function (id, val) {
      var el = document.getElementById(id);
      if (el && val != null && val !== '') el.value = val;
    };
    setVal('q-name',    ef.customer_name || inq.customer_name || (inq.from || '').split('<')[0].trim());
    setVal('q-email',   ef.customer_email || (inq.from || '').match(/<(.+)>/) ? (inq.from || '').match(/<(.+)>/)[1] : '');
    setVal('q-date',    ef.event_date || inq.event_date || '');
    setVal('q-guests',  ef.guest_count || inq.guest_count || '');
    setVal('q-address', ef.delivery_address || '');
    setVal('q-notes',   ef.notes || '');
    if (ef.service_type) {
      var svc = document.getElementById('q-service');
      if (svc) {
        var vals = ['pickup', 'delivery', 'delivery_setup'];
        var match = vals.find(function(v) { return v === ef.service_type; });
        if (match) svc.value = match;
      }
    }

    // Pre-fill quote line items into selectedItems
    if (q && q.line_items && q.line_items.length) {
      var lookup = buildMenuLookup();
      if (typeof selectedItems !== 'undefined') {
        // Reset
        Object.keys(selectedItems).forEach(function (k) { delete selectedItems[k]; });
      }
      q.line_items.forEach(function (li) {
        var key = normName(li.name);
        var menuItem = lookup[key];
        if (menuItem && typeof selectedItems !== 'undefined') {
          selectedItems[menuItem.id] = {
            price: li.unit_price || menuItem.price,
            name:  menuItem.name,
            unit:  menuItem.unit,
            qty:   li.qty || 1,
          };
        }
      });

      // Pre-fill pricing controls
      if (q.service_charge_pct != null) {
        var scEl = document.getElementById('q-sc-pct');
        if (!scEl) scEl = document.getElementById('q-service-charge-pct');
        if (scEl) scEl.value = q.service_charge_pct;
      }
      if (q.delivery_fee != null) {
        var dfEl = document.getElementById('q-delivery-fee');
        if (dfEl) dfEl.value = q.delivery_fee;
      }

      // Tax exempt
      if (typeof qbTaxExempt !== 'undefined') {
        window.qbTaxExempt = !!q.tax_exempt;
        var texChk = document.getElementById('q-tax-exempt');
        if (texChk) texChk.checked = !!q.tax_exempt;
      }

      // Rebuild menu picker checkboxes to reflect selectedItems
      var catMap = {
        meats: 'menu-meats', packages: 'menu-packages', sides: 'menu-sides',
        desserts: 'menu-desserts', drinks: 'menu-drinks', extras: 'menu-extras',
      };
      if (typeof buildMenuPicker === 'function') {
        Object.keys(catMap).forEach(function (cat) {
          buildMenuPicker(cat, catMap[cat]);
        });
      }
    }

    // Re-render preview
    if (typeof updatePreview === 'function') updatePreview();

    // Show revision banner
    var customerName = ef.customer_name || inq.customer_name || (inq.from || '').split('<')[0].trim() || 'customer';
    showRevisionBanner(customerName, inq.threadId);
  };

})();
