/* ===== MODULE: card-status-dropdown
   Wave 1 — Wires iOS-style <select> on each kanban card.
   No feature flag — replaces existing card status flow.

   Provides the change-event handler with BottomSheet lost-reason support.
   Falls back gracefully if lostReasonSheet is not available.

   API:
     cardStatusDropdown.wire(select, inq, onCommit)
       select   — the <select> element on the card
       inq      — the inquiry object { threadId, status }
       onCommit(newStatus: string, lostReason: string|null) — called to persist

   Exposes: window.cardStatusDropdown
   ===== */
(function () {
  'use strict';

  function wire(sel, inq, onCommit) {
    sel.addEventListener('change', function (e) {
      e.stopPropagation();
      var newStatus = sel.value;

      if (newStatus === inq.status) return;

      if (newStatus === 'declined') {
        if (window.lostReasonSheet) {
          window.lostReasonSheet.open(
            inq.threadId,
            function (reason) { onCommit(newStatus, reason); },
            function () { sel.value = inq.status; }
          );
        } else {
          // No BottomSheet module — commit immediately without reason
          onCommit(newStatus, null);
        }
      } else {
        onCommit(newStatus, null);
      }
    });
  }

  window.cardStatusDropdown = { wire: wire };
}());
