/* ===== MODULE: QUOTE BUILDER DRAFTS (Group 7 — quote_builder_v2 flag)
   localStorage-based draft save/load for the Quote Builder.
   Exposes: window.quoteDraftsInit
   ===== */
(function () {
  'use strict';

  var STORAGE_KEY  = 'qb_drafts';
  var AUTOSAVE_KEY = 'qb_autosave';
  var MAX_DRAFTS   = 10;
  var _autoTimer   = null;

  /* ── Persistence ─────────────────────────────────────────────────────────── */

  function readDrafts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function writeDrafts(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch (e) { console.warn('qb-drafts: write failed', e); }
  }

  /* ── State capture (DOM-based, no direct access to inline let vars) ───────── */

  function captureState() {
    var items = {};
    document.querySelectorAll('#page-quotes input[type=checkbox][data-id]:checked').forEach(function (cb) {
      var id = cb.getAttribute('data-id');
      var qtyEl = document.querySelector('.qty-input[data-item-id="' + id + '"]');
      items[id] = {
        price: parseFloat(cb.getAttribute('data-price')) || 0,
        name:  cb.getAttribute('data-name')  || '',
        unit:  cb.getAttribute('data-unit')  || '',
        qty:   qtyEl ? (parseInt(qtyEl.value) || 1) : 1,
      };
    });

    var get = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var chkEl = document.getElementById('qb-tax-exempt-chk');

    return {
      fields: {
        name:            get('q-name'),
        email:           get('q-email'),
        date:            get('q-date'),
        time:            get('q-time'),
        guests:          get('q-guests'),
        phone:           get('q-phone'),
        budgetAmt:       get('q-budget-amt'),
        address:         get('q-address'),
        service:         get('q-service'),
        budget:          get('q-budget'),
        specialRequests: get('q-special-requests'),
        chargePct:       get('charge-pct'),
        deliveryFee:     get('delivery-fee-input'),
        taxExempt:       chkEl ? chkEl.checked : false,
        taxExemptCert:   get('qb-tax-exempt-cert'),
      },
      items: items,
    };
  }

  /* ── State restore ───────────────────────────────────────────────────────── */

  function applyState(state) {
    if (!state) return;

    // Reset via newQuote() so selectedItems and qbTaxExempt are cleared
    if (typeof window.newQuote === 'function') window.newQuote();

    var f   = state.fields || {};
    var set = function (id, val) {
      var el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = val;
    };

    set('q-name',            f.name);
    set('q-email',           f.email);
    set('q-date',            f.date);
    set('q-time',            f.time);
    set('q-guests',          f.guests);
    set('q-phone',           f.phone);
    set('q-budget-amt',      f.budgetAmt);
    set('q-address',         f.address);
    set('q-service',         f.service || 'pickup');
    set('q-budget',          f.budget  || 'unknown');
    set('q-special-requests',f.specialRequests);
    set('charge-pct',        f.chargePct);
    set('delivery-fee-input',f.deliveryFee);

    // Tax exempt — qbToggleTaxExempt is a global function declaration
    if (f.taxExempt && typeof window.qbToggleTaxExempt === 'function') {
      window.qbToggleTaxExempt(true);
      var chkEl = document.getElementById('qb-tax-exempt-chk');
      if (chkEl) chkEl.checked = true;
      set('qb-tax-exempt-cert', f.taxExemptCert);
    }

    // Restore selected items by calling toggleItem() then setting qty
    Object.keys(state.items || {}).forEach(function (itemId) {
      var item = state.items[itemId];
      var cb   = document.querySelector('#page-quotes input[type=checkbox][data-id="' + itemId + '"]');
      if (!cb) return;
      if (!cb.checked && typeof window.toggleItem === 'function') {
        window.toggleItem(itemId, item.price, item.name, item.unit);
        cb.checked = true;
      }
      if (item.qty > 1) {
        if (typeof window.setItemQty === 'function') window.setItemQty(itemId, item.qty);
        var qtyEl = document.querySelector('.qty-input[data-item-id="' + itemId + '"]');
        if (qtyEl) qtyEl.value = item.qty;
      }
    });

    if (typeof window.updateQtyControls === 'function') window.updateQtyControls();
    if (typeof window.updatePreview     === 'function') window.updatePreview();
  }

  /* ── Auto-save ───────────────────────────────────────────────────────────── */

  function autoSave() {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(function () {
      var state      = captureState();
      var hasContent = state.fields.name || state.fields.email ||
                       Object.keys(state.items).length > 0;
      if (!hasContent) return;
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          savedAt: new Date().toISOString(),
          state:   state,
        }));
      } catch {}
      // Flash the badge
      var badge = document.getElementById('qb-autosave-badge');
      if (badge) {
        badge.style.opacity = '1';
        setTimeout(function () { badge.style.opacity = '0'; }, 2000);
      }
    }, 1500);
  }

  /* ── Save named draft ────────────────────────────────────────────────────── */

  function saveDraftPrompt() {
    var modal     = document.getElementById('qb-save-draft-modal');
    var nameInput = document.getElementById('qb-draft-name-input');
    if (!modal) return;
    // Pre-fill with customer name + date
    var cName = (document.getElementById('q-name') || {}).value || '';
    var cDate = (document.getElementById('q-date') || {}).value || '';
    if (nameInput) nameInput.value = cName ? cName + (cDate ? '  ·  ' + cDate : '') : '';
    modal.style.display = 'flex';
    if (nameInput) setTimeout(function () { nameInput.focus(); nameInput.select(); }, 50);
  }

  function confirmSaveDraft() {
    var nameInput = document.getElementById('qb-draft-name-input');
    var name      = (nameInput ? nameInput.value : '').trim();
    if (!name) { alert('Enter a draft name.'); return; }

    var drafts = readDrafts();
    while (drafts.length >= MAX_DRAFTS) drafts.shift();
    drafts.push({
      id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name:    name,
      savedAt: new Date().toISOString(),
      state:   captureState(),
    });
    writeDrafts(drafts);

    var modal = document.getElementById('qb-save-draft-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window.showToast === 'function') window.showToast('Draft saved: ' + name);
  }

  /* ── Drafts list modal ───────────────────────────────────────────────────── */

  function openDraftsModal() {
    var modal = document.getElementById('qb-drafts-modal');
    if (!modal) return;
    renderDraftsList();
    modal.style.display = 'flex';
  }

  function renderDraftsList() {
    var container = document.getElementById('qb-drafts-list');
    if (!container) return;

    var drafts    = readDrafts();
    var autoSaved = null;
    try { autoSaved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch {}

    var html = '';

    if (autoSaved && autoSaved.state) {
      var asLabel = (autoSaved.state.fields && autoSaved.state.fields.name) || 'Untitled';
      var asDate  = new Date(autoSaved.savedAt).toLocaleString('en-US', {
        month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
      });
      html += '<div class="qb-draft-item qb-draft-autosave">' +
        '<div class="qb-draft-item-body" onclick="window._qbDrafts.loadAutosave()">' +
          '<div class="qb-draft-title">Auto-saved: ' + esc(asLabel) + '</div>' +
          '<div class="qb-draft-meta">' + asDate + '</div>' +
        '</div>' +
        '<span class="qb-draft-badge">Auto</span>' +
        '</div>';
    }

    if (drafts.length === 0 && !autoSaved) {
      html += '<div class="qb-drafts-empty">No saved drafts yet.<br>Click "Save Draft" while building a quote.</div>';
    } else {
      drafts.slice().reverse().forEach(function (d) {
        var dDate     = new Date(d.savedAt).toLocaleString('en-US', {
          month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
        });
        var itemCount = Object.keys((d.state && d.state.items) || {}).length;
        html += '<div class="qb-draft-item">' +
          '<div class="qb-draft-item-body" onclick="window._qbDrafts.loadDraft(\'' + d.id + '\')">' +
            '<div class="qb-draft-title">' + esc(d.name) + '</div>' +
            '<div class="qb-draft-meta">' + dDate + ' · ' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + '</div>' +
          '</div>' +
          '<button class="qb-draft-del-btn" onclick="window._qbDrafts.deleteDraft(\'' + d.id + '\')" title="Delete">×</button>' +
          '</div>';
      });
    }

    container.innerHTML = html;
  }

  function loadDraft(id) {
    var draft = readDrafts().find(function (d) { return d.id === id; });
    if (!draft) return;
    applyState(draft.state);
    var modal = document.getElementById('qb-drafts-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window.showToast === 'function') window.showToast('Draft loaded: ' + draft.name);
  }

  function loadAutosave() {
    var autoSaved = null;
    try { autoSaved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch {}
    if (!autoSaved || !autoSaved.state) return;
    applyState(autoSaved.state);
    var modal = document.getElementById('qb-drafts-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window.showToast === 'function') window.showToast('Auto-saved quote restored!');
  }

  function deleteDraft(id) {
    writeDrafts(readDrafts().filter(function (d) { return d.id !== id; }));
    renderDraftsList();
  }

  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Init ────────────────────────────────────────────────────────────────── */

  function quoteDraftsInit() {
    // Auto-save on any input change in the quote builder
    var qbPage = document.getElementById('page-quotes');
    if (qbPage) {
      qbPage.addEventListener('input',  function () { autoSave(); });
      qbPage.addEventListener('change', function () { autoSave(); });
    }
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */

  window._qbDrafts = {
    openDraftsModal:  openDraftsModal,
    saveDraftPrompt:  saveDraftPrompt,
    confirmSaveDraft: confirmSaveDraft,
    loadDraft:        loadDraft,
    loadAutosave:     loadAutosave,
    deleteDraft:      deleteDraft,
  };

  window.quoteDraftsInit = quoteDraftsInit;
})();
