/* ===== MODULE: TEST CUSTOMER MODE
   Gated by the 'test_customer_mode' feature flag.
   When enabled:
   - "+ Test Inquiry" button appears in Inquiries header
   - Settings page shows "Show test data" toggle and "Delete all test data" button
   - Test inquiries (threadId starts with 'test-') are shown when showTestData is true
   - Test badge rendered via window.testMode.isTestInquiry(inq)

   Exposes:
     window.testMode.init()                  — call after flags.load()
     window.testMode.isTestInquiry(inq)      — true when inq.test === true OR threadId starts 'test-'
     window.testMode.shouldShowInquiry(inq)  — false for test inquiries when showTestData is off
     window.testMode.createTestInquiry()     — async; POSTs to /api/inquiries/test
     window.testMode.deleteAllTestData()     — async; deletes all test inquiries via API
     window.showTestData                     — bool, readable by inline index.html code
   ===== */
(function () {
  'use strict';

  window.showTestData = false;

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function isEnabled() {
    return window.flags && window.flags.isEnabled('test_customer_mode');
  }

  function isTestInquiry(inq) {
    if (!inq) return false;
    return inq.test === true || (typeof inq.threadId === 'string' && inq.threadId.startsWith('test-'));
  }

  function shouldShowInquiry(inq) {
    if (!isTestInquiry(inq)) return true;
    return !!window.showTestData;
  }

  function setShowTestData(val) {
    window.showTestData = !!val;
    const cb = document.getElementById('tm-show-test-data');
    if (cb) cb.checked = window.showTestData;
    // Trigger re-render if dashboard functions are available
    if (typeof renderInqCards === 'function') renderInqCards();
    if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
  }

  async function createTestInquiry() {
    const btn = document.getElementById('tm-create-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    try {
      const r = await fetch('/api/inquiries/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Unknown error');
      // Switch to test data view so the new inquiry is visible
      setShowTestData(true);
      if (typeof loadInquiries === 'function') loadInquiries();
      else if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
      showToast('Test inquiry created: ' + d.threadId);
    } catch (e) {
      showToast('Failed to create test inquiry: ' + e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '+ Test Inquiry'; }
    }
  }

  async function deleteAllTestData() {
    if (!confirm('Delete ALL test inquiries? This cannot be undone.')) return;
    const btn = document.getElementById('tm-delete-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
    try {
      // There's no dedicated delete-test endpoint yet — call /api/inquiries/list,
      // find test threadIds, and archive them via /api/inquiries/archive.
      const r = await fetch('/api/inquiries/list?secret=' + secret());
      const d = await r.json();
      const testInqs = (d.inquiries || []).filter(isTestInquiry);
      await Promise.all(testInqs.map(inq =>
        fetch('/api/inquiries/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: secret(), threadId: inq.threadId }),
        })
      ));
      showToast('Deleted ' + testInqs.length + ' test inquiry(s)');
      if (typeof loadInquiries === 'function') loadInquiries();
      else if (typeof loadPipelineInquiries === 'function') loadPipelineInquiries();
    } catch (e) {
      showToast('Delete failed: ' + e.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Delete all test data'; }
    }
  }

  function showToast(msg, isErr) {
    // Reuse existing toast if present; fallback to alert
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
    setTimeout(function () { t.remove(); }, 3500);
  }

  function renderTestControls() {
    // "+ Test Inquiry" button in Inquiries topbar
    const actionsEl = document.getElementById('inq-topbar-actions');
    if (actionsEl) {
      var existing = document.getElementById('tm-create-btn');
      if (!existing) {
        var btn = document.createElement('button');
        btn.id = 'tm-create-btn';
        btn.className = 'btn btn-sm';
        btn.style.cssText = 'background:#f59e0b;color:#000;border-color:#f59e0b;font-size:11px;';
        btn.textContent = '+ Test Inquiry';
        btn.onclick = createTestInquiry;
        actionsEl.insertBefore(btn, actionsEl.firstChild);
      }
    }

    // Settings controls in the flags settings page
    var settingsPanel = document.getElementById('tm-settings-panel');
    if (settingsPanel) {
      settingsPanel.style.display = '';
      if (!settingsPanel.dataset.rendered) {
        settingsPanel.dataset.rendered = '1';
        settingsPanel.innerHTML =
          '<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text1)">Test Customer Mode</div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer;margin-bottom:8px">' +
          '<input type="checkbox" id="tm-show-test-data" onchange="window.testMode._setShowTestData(this.checked)">' +
          'Show test inquiries in dashboard</label>' +
          '<button id="tm-delete-btn" class="btn btn-sm" style="font-size:11px;background:#dc2626;color:#fff;border-color:#dc2626;width:100%"' +
          ' onclick="window.testMode.deleteAllTestData()">Delete all test data</button>';
      }
    }
  }

  function init() {
    if (!isEnabled()) return;
    renderTestControls();
  }

  window.testMode = {
    init:               init,
    isTestInquiry:      isTestInquiry,
    shouldShowInquiry:  shouldShowInquiry,
    createTestInquiry:  createTestInquiry,
    deleteAllTestData:  deleteAllTestData,
    _setShowTestData:   setShowTestData,
  };
})();
