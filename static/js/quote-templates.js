/* ===== MODULE: QUOTE TEMPLATE LIBRARY
   Renders template management UI on the flags/settings page.
   Also provides template picker for the Quote Builder.
   Exposes:
     window.quoteTemplates.initSettings()  — render settings panel
     window.quoteTemplates.initPicker()    — render picker in quote builder
     window.quoteTemplates.applyTemplate(tpl) — load template into QB
   ===== */
(function () {
  'use strict';

  let _templates = [];
  let _editingId = null;

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function showToast(msg, isErr) {
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, isErr ? 'error' : 'success');
      return;
    }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:8px;' +
      'background:' + (isErr ? '#dc2626' : '#16a34a') + ';color:#fff;font-size:13px;z-index:9999;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.2)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function loadTemplates() {
    try {
      const r = await fetch('/api/quotes/templates?secret=' + encodeURIComponent(secret()));
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Load failed');
      _templates = d.templates || [];
      return _templates;
    } catch (err) {
      console.warn('[quote-templates] load error:', err.message);
      return [];
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
      const r = await fetch('/api/quotes/templates/' + id + '?secret=' + encodeURIComponent(secret()), {
        method: 'DELETE',
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Delete failed');
      showToast('Template deleted');
      await loadTemplates();
      renderSettingsList();
      refreshPicker();
    } catch (err) {
      showToast('Delete failed: ' + err.message, true);
    }
  }

  async function saveTemplate(id) {
    const nameEl = document.getElementById('qtl-new-name');
    const stEl   = document.getElementById('qtl-new-service-type');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { showToast('Template name is required', true); return; }

    // Capture current QB line items if available
    let line_items = [];
    let service_type = stEl ? stEl.value : 'pickup';
    let service_charge_pct = 20;
    let delivery_fee = 0;

    if (typeof window.getQBLineItems === 'function') {
      line_items = window.getQBLineItems() || [];
    }
    if (typeof window.getQBServiceType === 'function') {
      service_type = window.getQBServiceType() || service_type;
    }
    if (typeof window.getQBServiceCharge === 'function') {
      service_charge_pct = window.getQBServiceCharge() || 20;
    }
    if (typeof window.getQBDeliveryFee === 'function') {
      delivery_fee = window.getQBDeliveryFee() || 0;
    }

    const url = id
      ? '/api/quotes/templates/' + id + '?secret=' + encodeURIComponent(secret())
      : '/api/quotes/templates?secret=' + encodeURIComponent(secret());

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, line_items, service_type, service_charge_pct, delivery_fee }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Save failed');
      showToast(id ? 'Template updated' : 'Template created');
      _editingId = null;
      await loadTemplates();
      renderSettingsList();
      refreshPicker();
    } catch (err) {
      showToast('Save failed: ' + err.message, true);
    }
  }

  function renderSettingsList() {
    const listEl = document.getElementById('qtl-list');
    const formEl = document.getElementById('qtl-new-form');
    if (!listEl) return;

    if (_templates.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0;font-style:italic">No templates yet. Create one below.</div>';
    } else {
      listEl.innerHTML = _templates.map(t => `
        <div class="qtl-item">
          <div style="flex:1;min-width:0">
            <div class="qtl-item-name">${t.name}</div>
            <div class="qtl-item-meta">${t.service_type || 'pickup'} · ${(t.line_items || []).length} items · ${t.service_charge_pct || 20}% service</div>
          </div>
          <div class="qtl-item-actions">
            <button class="btn btn-sm" onclick="window.quoteTemplates.editInQB('${t.id}')">Load in QB</button>
            <button class="btn btn-sm" style="color:var(--red);border-color:var(--red-border)" onclick="window.quoteTemplates.delete('${t.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    }

    // Show new-template form
    if (formEl) {
      formEl.style.display = '';
      const nameEl = formEl.querySelector('#qtl-new-name');
      if (nameEl) nameEl.value = '';
    }
  }

  function renderSettingsPanel() {
    const panel = document.getElementById('quote-templates-panel');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = '1';
    panel.innerHTML = `
      <div class="qtl-wrap">
        <div class="qtl-hdr">Quote Templates</div>
        <div class="qtl-list" id="qtl-list">Loading…</div>
        <div class="qtl-new-form" id="qtl-new-form" style="display:none">
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">Template Name</label>
            <input id="qtl-new-name" class="form-input" placeholder="e.g. Corporate Lunch 50ppl" style="font-size:12px">
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">Service Type</label>
            <select id="qtl-new-service-type" class="form-select" style="font-size:12px">
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
              <option value="delivery_setup">Delivery + Setup</option>
            </select>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:10px">Line items will be captured from the current Quote Builder state (if open).</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="window.quoteTemplates.save()">Save Template</button>
          </div>
        </div>
      </div>`;
    loadTemplates().then(() => renderSettingsList());
  }

  function renderPicker() {
    const bar = document.getElementById('qt-template-bar');
    if (!bar) return;
    const select = document.getElementById('qt-template-select');
    if (!select) return;

    select.innerHTML = '<option value="">— Start from template —</option>' +
      _templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  }

  function refreshPicker() {
    renderPicker();
  }

  function initPicker() {
    const bar = document.getElementById('qt-template-bar');
    if (!bar || bar.dataset.rendered) return;
    bar.dataset.rendered = '1';
    bar.innerHTML = `
      <span class="qt-template-label">Template:</span>
      <select class="qt-template-select" id="qt-template-select">
        <option value="">— Start from template —</option>
      </select>
      <button class="btn btn-sm qt-template-load-btn" onclick="window.quoteTemplates.loadSelected()">Load</button>
      <button class="btn btn-sm" onclick="window.quoteTemplates.saveNew()" title="Save current QB as template">Save as Template</button>
    `;
    loadTemplates().then(() => renderPicker());
  }

  function loadSelected() {
    const sel = document.getElementById('qt-template-select');
    if (!sel || !sel.value) return;
    const tpl = _templates.find(t => t.id === sel.value);
    if (!tpl) return;
    applyTemplate(tpl);
    sel.value = '';
  }

  function applyTemplate(tpl) {
    if (!tpl) return;
    if (typeof window.loadQBTemplate === 'function') {
      window.loadQBTemplate(tpl);
      showToast('Template loaded: ' + tpl.name);
    } else {
      showToast('Quote Builder not ready — open a quote first', true);
    }
  }

  function editInQB(id) {
    const tpl = _templates.find(t => t.id === id);
    if (!tpl) return;
    // Navigate to QB and load template
    if (typeof window.showPage === 'function') window.showPage('quotes');
    setTimeout(() => applyTemplate(tpl), 300);
  }

  function saveNew() {
    const panel = document.getElementById('quote-templates-panel');
    if (!panel) {
      showToast('Open Settings → Quote Templates to manage templates', false);
      return;
    }
    saveTemplate(null);
  }

  function initSettings() {
    renderSettingsPanel();
  }

  window.quoteTemplates = {
    initSettings,
    initPicker,
    loadSelected,
    applyTemplate,
    editInQB,
    save: () => saveTemplate(_editingId),
    delete: deleteTemplate,
    saveNew,
    refresh: () => { loadTemplates().then(() => { renderSettingsList(); refreshPicker(); }); },
  };
})();
