/* ===== MODULE: tag-picker
   Wave 1 — Customer tag picker + tag chip rendering on inquiry cards.
   Feature flag: customer_tags (default true).

   Seeded tags: VIP, Corporate, Holiday Party Regular, Graduation, Family Get Together
   Tags stored in KV: customer:tags:{email} → string[]
   API: GET/POST /api/customers/tags

   API:
     tagPicker.init(container, email)  — renders full picker in container
     tagPicker.getTags(email)          — returns cached tags ([] if unknown)
     tagPicker.prefetch(emails)        — batch-prefetch tags for an email array
     tagPicker.renderChips(email)      — returns HTML string of tag chips for a card

   Exposes: window.tagPicker
   ===== */
(function () {
  'use strict';

  var SEEDED_TAGS = ['VIP', 'Corporate', 'Holiday Party Regular', 'Graduation', 'Family Get Together'];
  var _cache = {};      // email → string[]
  var _pending = {};    // email → true while fetching

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  function isEnabled() {
    return !window.flags || !window.flags.isEnabled || window.flags.isEnabled('customer_tags');
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Fetch tags for one email ── */

  function fetchTags(email) {
    if (!email || _cache[email] !== undefined || _pending[email]) return;
    _pending[email] = true;
    fetch('/api/customers/tags?secret=' + encodeURIComponent(getSecret()) + '&email=' + encodeURIComponent(email), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _cache[email] = (d.ok && Array.isArray(d.tags)) ? d.tags : [];
        delete _pending[email];
        // Refresh any visible chips for this email
        document.querySelectorAll('.kb-card[data-email="' + CSS.escape(email) + '"] .kb-card-customer-tags')
          .forEach(function (el) { el.innerHTML = _chipHtml(_cache[email]); el.style.display = el.innerHTML ? '' : 'none'; });
        document.querySelectorAll('[data-ctp-email="' + CSS.escape(email) + '"]')
          .forEach(function (el) { el.innerHTML = _chipHtml(_cache[email]); el.style.display = el.innerHTML ? '' : 'none'; });
      })
      .catch(function () { delete _pending[email]; _cache[email] = []; });
  }

  /* ── Save tag mutation ── */

  function saveTags(email, add, remove, callback) {
    var body = { email: email, secret: getSecret() };
    if (add    && add.length)    body.add    = add;
    if (remove && remove.length) body.remove = remove;

    fetch('/api/customers/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok && Array.isArray(d.tags)) _cache[email] = d.tags;
      if (typeof callback === 'function') callback(_cache[email] || []);
    })
    .catch(function () { if (typeof callback === 'function') callback(_cache[email] || []); });
  }

  /* ── Chip HTML helper ── */

  function _chipHtml(tags) {
    if (!tags || !tags.length) return '';
    return tags.map(function (t) {
      return '<span class="ctp-chip">' + escHtml(t) + '</span>';
    }).join('');
  }

  /* ── Full picker init (for customer profile) ── */

  function init(container, email) {
    if (!container || !email) return;
    if (!isEnabled()) { container.style.display = 'none'; return; }

    email = email.toLowerCase().trim();
    container.className = 'ctp-container';
    container.innerHTML = '<div class="ctp-loading">Loading tags\u2026</div>';

    // Ensure we have the tags
    var renderPicker = function (tags) {
      container.innerHTML = '';

      // Section header
      var hdr = document.createElement('div');
      hdr.className = 'ctp-section-hdr';
      hdr.textContent = 'Customer Tags';
      container.appendChild(hdr);

      // Seeded + existing tags as toggles
      var allOptions = SEEDED_TAGS.slice();
      tags.forEach(function (t) {
        if (!allOptions.some(function (s) { return s.toLowerCase() === t.toLowerCase(); })) {
          allOptions.push(t);
        }
      });

      var tagSet = new Set(tags.map(function (t) { return t.toLowerCase(); }));

      var pillsWrap = document.createElement('div');
      pillsWrap.className = 'ctp-pills';

      allOptions.forEach(function (t) {
        var pill = document.createElement('button');
        pill.className = 'ctp-pill' + (tagSet.has(t.toLowerCase()) ? ' ctp-pill-on' : '');
        pill.textContent = t;
        pill.addEventListener('click', function () {
          var isOn = pill.classList.contains('ctp-pill-on');
          if (isOn) {
            // remove tag
            saveTags(email, [], [t], function (updated) {
              _cache[email] = updated;
              tagSet = new Set(updated.map(function (x) { return x.toLowerCase(); }));
              pill.classList.remove('ctp-pill-on');
              _refreshChips();
            });
          } else {
            // add tag
            saveTags(email, [t], [], function (updated) {
              _cache[email] = updated;
              tagSet = new Set(updated.map(function (x) { return x.toLowerCase(); }));
              pill.classList.add('ctp-pill-on');
              _refreshChips();
            });
          }
        });
        pillsWrap.appendChild(pill);
      });

      container.appendChild(pillsWrap);

      // Freeform "Add tag" input
      var addRow = document.createElement('div');
      addRow.className = 'ctp-add-row';
      var addInput = document.createElement('input');
      addInput.className = 'ctp-add-input';
      addInput.type = 'text';
      addInput.placeholder = 'Add tag\u2026';
      addInput.maxLength = 40;
      var addBtn = document.createElement('button');
      addBtn.className = 'btn btn-sm';
      addBtn.textContent = 'Add';

      function doAdd() {
        var val = addInput.value.trim();
        if (!val) return;
        saveTags(email, [val], [], function (updated) {
          _cache[email] = updated;
          addInput.value = '';
          init(container, email); // re-render with updated tags
        });
      }

      addBtn.addEventListener('click', doAdd);
      addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      container.appendChild(addRow);

      function _refreshChips() {
        var chipEl;
        document.querySelectorAll('.kb-card[data-email="' + CSS.escape(email) + '"] .kb-card-customer-tags')
          .forEach(function (el) {
            el.innerHTML = _chipHtml(_cache[email]);
            el.style.display = el.innerHTML ? '' : 'none';
          });
        document.querySelectorAll('[data-ctp-email="' + CSS.escape(email) + '"]')
          .forEach(function (el) {
            el.innerHTML = _chipHtml(_cache[email]);
            el.style.display = el.innerHTML ? '' : 'none';
          });
      }
    };

    if (_cache[email] !== undefined) {
      renderPicker(_cache[email]);
    } else {
      fetch('/api/customers/tags?secret=' + encodeURIComponent(getSecret()) + '&email=' + encodeURIComponent(email), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          _cache[email] = (d.ok && Array.isArray(d.tags)) ? d.tags : [];
          renderPicker(_cache[email]);
        })
        .catch(function () { _cache[email] = []; renderPicker([]); });
    }
  }

  /* ── Public API ── */

  function getTags(email) {
    if (!email) return [];
    email = email.toLowerCase().trim();
    if (_cache[email] !== undefined) return _cache[email];
    fetchTags(email);
    return [];
  }

  function prefetch(emails) {
    if (!isEnabled()) return;
    var unique = [];
    (emails || []).forEach(function (e) {
      if (e && _cache[e] === undefined && !_pending[e] && unique.indexOf(e) === -1) unique.push(e);
    });
    unique.forEach(fetchTags);
  }

  function renderChips(email) {
    if (!isEnabled()) return '';
    email = (email || '').toLowerCase().trim();
    var tags = getTags(email);
    return _chipHtml(tags);
  }

  window.tagPicker = {
    init: init,
    getTags: getTags,
    prefetch: prefetch,
    renderChips: renderChips,
  };
}());
