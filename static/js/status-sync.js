/* ===== MODULE: STATUS-SYNC (Rule 14)
   File: static/js/status-sync.js
   Loaded by: index.html <script src="/static/js/status-sync.js">
   Exposes: window.statusSync = { get, set, onChange, _hydrate }

   Single PATCH path for status changes across Kanban columns,
   Inquiry list drop-downs, and Pipeline list drop-downs.
   Optimistic update with rollback on failure.
   ===== */
(function () {
  'use strict';

  function getSecret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') || (window.INQ_SECRET || '');
  }

  var _store     = new Map();  // threadId → status string
  var _listeners = [];

  function _notify(threadId, newStatus, prevStatus) {
    _listeners.forEach(function (cb) {
      try { cb(threadId, newStatus, prevStatus); } catch (_) {}
    });
  }

  var _api = {
    /**
     * Seed the internal store from an array of inquiry objects.
     * Call after loading pipelineInqCache or inquiriesCache so all
     * three surfaces start in sync without an extra round-trip.
     */
    _hydrate: function (inquiries) {
      if (!Array.isArray(inquiries)) return;
      inquiries.forEach(function (inq) {
        if (inq && inq.threadId && inq.status) {
          _store.set(inq.threadId, inq.status);
        }
      });
    },

    /** Returns current cached status or null if unknown. */
    get: function (threadId) {
      return _store.has(threadId) ? _store.get(threadId) : null;
    },

    /**
     * Optimistically updates status, fires listeners, then persists via API.
     * On HTTP error, rolls back and re-fires listeners.
     *
     * opts.skipCalendar — if true, suppress auto-create calendar event on 'booked'
     * Returns a Promise that resolves on success, rejects on failure.
     */
    set: function (threadId, newStatus, opts) {
      opts = opts || {};
      var prev = _store.get(threadId) || null;
      if (prev === newStatus) return Promise.resolve();

      // Optimistic
      _store.set(threadId, newStatus);
      _notify(threadId, newStatus, prev);

      var secret = getSecret();
      return fetch('/api/inquiries/save?secret=' + encodeURIComponent(secret), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadId,
          status: newStatus,
          history_entry: { action: 'status_changed_to_' + newStatus, actor: 'user' }
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'save failed');
        // Side-effect: calendar auto-create on booking
        if (newStatus === 'booked' && !opts.skipCalendar && typeof calAutoCreateOnBooking === 'function') {
          calAutoCreateOnBooking(threadId).catch(function (e) {
            console.warn('Calendar auto-create (non-fatal):', e.message);
          });
        }
      }).catch(function (err) {
        // Rollback
        if (prev !== null) _store.set(threadId, prev);
        else _store.delete(threadId);
        _notify(threadId, prev, newStatus);
        if (typeof showToast === 'function') showToast('Status update failed');
        throw err;
      });
    },

    /**
     * Register a listener called whenever any status changes.
     * cb(threadId, newStatus, prevStatus)
     */
    onChange: function (cb) {
      _listeners.push(cb);
    }
  };

  window.statusSync = _api;
})();
