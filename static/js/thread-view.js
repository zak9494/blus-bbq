/* ===== MODULE: THREAD VIEW (Wave 4 — email_thread_v2)
   iMessage-style email/SMS thread renderer for the inquiry detail panel.
   Exposes: window.threadView.init(containerId, inquiry), window.threadView.destroy()

   Data model is channel-agnostic: each message has { direction, channel, body, ... }.
   Adding SMS later is a data-source change in the API, not a UI change here.
   ===== */
(function () {
  'use strict';

  /* ── State ────────────────────────────────────────────────────────────── */

  let _containerId = null;
  let _inquiry = null;
  let _pendingAttachments = [];

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  function secret() {
    return (typeof INQ_SECRET !== 'undefined' ? INQ_SECRET : '') ||
           (typeof window.INQ_SECRET !== 'undefined' ? window.INQ_SECRET : '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uid() {
    return 'tv' + Math.random().toString(36).slice(2, 8);
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ── Signature stripping ──────────────────────────────────────────────── */

  const SIG_PATTERNS = [
    /^--\s*$/m,                        // standard sig separator
    /^Sent from my .+/m,               // mobile footers
    /^Get Outlook for .+/m,
    /^_{3,}/m,                         // ___ separators common in Outlook
  ];

  function stripSignature(text) {
    for (const pat of SIG_PATTERNS) {
      const m = pat.exec(text);
      if (m) return text.slice(0, m.index).trimEnd();
    }
    return text;
  }

  /* ── Quoted-text splitting ────────────────────────────────────────────── */

  function splitQuoted(text) {
    const lines = text.split('\n');
    // First line starting with > that isn't immediately followed by body text
    // (common quote-reply pattern)
    const idx = lines.findIndex(l => /^>/.test(l.trimStart()));
    if (idx === -1) return { body: text, quoted: '' };
    return {
      body: lines.slice(0, idx).join('\n').trimEnd(),
      quoted: lines.slice(idx).join('\n'),
    };
  }

  /* ── Date / time formatting ───────────────────────────────────────────── */

  function dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const toDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = toDay(now) - toDay(d);
    if (diff === 0) return 'Today';
    if (diff === 86400000) return 'Yesterday';
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago',
    });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago',
    });
  }

  function fmtMeta(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + fmtTime(iso);
  }

  /* ── Bubble renderer ─────────────────────────────────────────────────── */

  const LINE_LIMIT = 6;

  function renderBubble(msg) {
    let body = stripSignature(msg.body || '');
    const { body: mainBody, quoted } = splitQuoted(body);

    const lines = mainBody.split('\n');
    const truncated = lines.length > LINE_LIMIT;
    const visibleText = truncated ? lines.slice(0, LINE_LIMIT).join('\n') : mainBody;
    const hiddenText = truncated ? lines.slice(LINE_LIMIT).join('\n') : '';

    const truncId = uid();
    const quoteId = uid();

    let html = '<div class="tv-bubble-text">' + esc(visibleText).replace(/\n/g, '<br>');

    if (truncated) {
      html += '<span class="tv-hidden-text" id="' + truncId + '" style="display:none">' +
        '<br>' + esc(hiddenText).replace(/\n/g, '<br>') + '</span>' +
        '<button class="tv-expand-btn" onclick="' +
        'var e=document.getElementById(\'' + truncId + '\');' +
        'var vis=e.style.display===\'none\'||e.style.display===\'\';' +
        'e.style.display=vis?\'\':\'none\';' +
        'this.textContent=vis?\'Show less\':\'Show more\';' +
        '">Show more</button>';
    }

    html += '</div>';

    if (quoted) {
      html += '<div class="tv-quoted-wrap">' +
        '<button class="tv-quoted-btn" id="' + quoteId + '-btn" onclick="' +
        'var b=document.getElementById(\'' + quoteId + '\');' +
        'var shown=b.style.display!==\'none\';' +
        'b.style.display=shown?\'none\':\'\';' +
        'this.textContent=shown?\'Show quoted text\':\'Hide quoted text\';' +
        '">Show quoted text</button>' +
        '<div class="tv-quoted-body" id="' + quoteId + '" style="display:none">' +
        esc(quoted).replace(/\n/g, '<br>') +
        '</div></div>';
    }

    if (msg.attachments && msg.attachments.length) {
      html += '<div class="tv-attach-row">' +
        msg.attachments.map(a =>
          '<span class="tv-attach-chip" title="' + esc(a.name) + '">' +
          '📎 ' + esc(a.name) + (a.size ? ' · ' + fmtSize(a.size) : '') +
          '</span>'
        ).join('') +
        '</div>';
    }

    if (msg.channel === 'sms') {
      html += '<span class="tv-sms-chip">SMS</span>';
    }

    return html;
  }

  /* ── Cluster builder ─────────────────────────────────────────────────── */

  const CLUSTER_GAP_MS = 15 * 60 * 1000; // 15 minutes

  function buildClusters(messages) {
    const clusters = [];
    let cur = null;
    for (const msg of messages) {
      const ts = new Date(msg.date).getTime();
      if (cur &&
          cur.direction === msg.direction &&
          (ts - cur.lastTs) <= CLUSTER_GAP_MS) {
        cur.messages.push(msg);
        cur.lastTs = ts;
      } else {
        cur = {
          direction: msg.direction,
          fromName: msg.fromName || msg.from || '',
          messages: [msg],
          firstTs: ts,
          lastTs: ts,
        };
        clusters.push(cur);
      }
    }
    return clusters;
  }

  /* ── Full thread render ──────────────────────────────────────────────── */

  function renderThread(msgsEl, messages) {
    if (!messages || !messages.length) {
      msgsEl.innerHTML = '<div class="tv-empty">No messages yet.</div>';
      return;
    }

    const clusters = buildClusters(messages);
    let html = '';
    let lastDay = '';

    for (const cluster of clusters) {
      const day = dayLabel(cluster.messages[0].date);
      if (day !== lastDay) {
        html += '<div class="tv-date-divider"><span>' + esc(day) + '</span></div>';
        lastDay = day;
      }

      const dir = cluster.direction === 'outbound' ? 'outbound' : 'inbound';
      const name = dir === 'outbound' ? "Blu\u2019s BBQ" : (cluster.fromName || 'Customer');
      const ts = fmtMeta(cluster.messages[0].date);

      html += '<div class="tv-cluster ' + dir + '">';
      html += '<div class="tv-cluster-meta">' + esc(name) + ' \u00b7 ' + esc(ts) + '</div>';

      for (const msg of cluster.messages) {
        html += '<div class="tv-bubble ' + dir + '">' + renderBubble(msg) + '</div>';
      }

      html += '</div>';
    }

    msgsEl.innerHTML = html;
    // Auto-scroll to latest
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /* ── Message fetching ────────────────────────────────────────────────── */

  async function fetchMessages(threadId) {
    try {
      const r = await fetch(
        '/api/inquiries/thread?threadId=' + encodeURIComponent(threadId) +
        '&secret=' + encodeURIComponent(secret()),
        { cache: 'no-store' }
      );
      if (!r.ok) return null;
      const d = await r.json();
      return (d.ok && Array.isArray(d.messages)) ? d.messages : null;
    } catch {
      return null;
    }
  }

  /* ── Composer HTML ───────────────────────────────────────────────────── */

  function composerHTML() {
    return [
      '<div class="tv-composer">',
      '<div class="tv-composer-top">',
      '<div class="tv-channel-toggle">',
      '<button class="tv-chan-btn active" id="tv-chan-email">Email</button>',
      '<button class="tv-chan-btn tv-chan-disabled" id="tv-chan-sms"',
      ' title="SMS coming soon" onclick="return false">SMS</button>',
      '</div></div>',
      '<div class="tv-composer-body">',
      '<textarea class="tv-textarea" id="tv-compose-text"',
      ' placeholder="Type a message\u2026" rows="2"></textarea>',
      '</div>',
      '<div class="tv-composer-actions">',
      '<label class="btn tv-icon-btn" title="Attach file">',
      '\uD83D\uDCCE',
      '<input type="file" id="tv-attach-input" style="display:none"',
      ' onchange="window.tvHandleAttach(this)" multiple>',
      '</label>',
      '<button class="btn tv-icon-btn" id="tv-ai-draft-btn"',
      ' onclick="window.tvRequestAIDraft()">✨ AI Draft</button>',
      '<button class="btn btn-primary tv-send-btn" id="tv-send-btn"',
      ' onclick="window.tvSendMessage()">Send</button>',
      '</div>',
      '<div id="tv-attach-preview" class="tv-attach-preview"></div>',
      '</div>',
    ].join('');
  }

  /* ── Attachment preview ──────────────────────────────────────────────── */

  function renderAttachPreview() {
    const el = document.getElementById('tv-attach-preview');
    if (!el) return;
    el.innerHTML = _pendingAttachments.map((f, i) =>
      '<span class="tv-attach-chip">' + esc(f.name) +
      ' <button onclick="window.tvRemoveAttach(' + i + ')"' +
      ' style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0 0 0 3px;font-size:12px"' +
      ' aria-label="Remove">×</button></span>'
    ).join('');
  }

  window.tvHandleAttach = function (input) {
    _pendingAttachments = _pendingAttachments.concat(Array.from(input.files || []));
    renderAttachPreview();
    input.value = '';
  };

  window.tvRemoveAttach = function (idx) {
    _pendingAttachments.splice(idx, 1);
    renderAttachPreview();
  };

  /* ── Send ────────────────────────────────────────────────────────────── */

  window.tvSendMessage = async function () {
    if (!_inquiry) return;
    const textarea = document.getElementById('tv-compose-text');
    const body = textarea ? textarea.value.trim() : '';
    if (!body) return;

    const ef = (_inquiry.extracted_fields || {});
    const to = ef.customer_email || _inquiry.from || '';
    if (!to) {
      if (typeof showToast === 'function') showToast('No customer email on file');
      return;
    }

    const btn = document.getElementById('tv-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending\u2026'; }

    try {
      const r = await fetch('/api/inquiries/send-now?secret=' + encodeURIComponent(secret()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: 'Re: ' + (_inquiry.subject || 'Your catering inquiry'),
          body,
          threadId: _inquiry.threadId,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        if (textarea) textarea.value = '';
        _pendingAttachments = [];
        renderAttachPreview();
        if (typeof showToast === 'function') showToast('Message sent \u2713');
        // Reload thread to show sent message
        if (_containerId && _inquiry) init(_containerId, _inquiry);
      } else {
        if (typeof showToast === 'function') showToast('Send failed: ' + (d.error || 'unknown'));
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Send error: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    }
  };

  /* ── AI Draft ────────────────────────────────────────────────────────── */

  window.tvRequestAIDraft = async function () {
    if (!_inquiry) return;
    const btn = document.getElementById('tv-ai-draft-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Drafting\u2026'; }

    try {
      // 1. Generate draft via existing draft-email endpoint
      const r = await fetch('/api/inquiries/draft-email?secret=' + encodeURIComponent(secret()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'reply', inquiry: _inquiry }),
      });
      const d = await r.json();
      if (!d.ok || !d.body) throw new Error(d.error || 'Draft generation failed');

      const ef = _inquiry.extracted_fields || {};
      const to = ef.customer_email || _inquiry.from || '';

      // 2. Route through approval queue — do NOT send directly
      const qr = await fetch('/api/chat/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: secret(),
          item: {
            to,
            subject: d.subject || 'Re: ' + (_inquiry.subject || 'Your catering inquiry'),
            body: d.body,
            threadId: _inquiry.threadId,
          },
        }),
      });
      const qd = await qr.json();
      if (!qd.ok) throw new Error(qd.error || 'Queue write failed');

      if (typeof showToast === 'function') showToast('AI draft added to approval queue \u2713');
    } catch (e) {
      if (typeof showToast === 'function') showToast('AI Draft failed: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '\u2728 AI Draft'; }
    }
  };

  /* ── Public API ──────────────────────────────────────────────────────── */

  async function init(containerId, inquiry) {
    _containerId = containerId;
    _inquiry = inquiry;
    _pendingAttachments = [];

    const container = document.getElementById(containerId);
    if (!container) return;

    // Render skeleton immediately
    container.innerHTML =
      '<div class="tv-thread">' +
      '<div class="tv-msgs" id="tv-msgs-inner">' +
      '<div class="tv-loading">Loading conversation\u2026</div>' +
      '</div>' +
      composerHTML() +
      '</div>';

    const msgsEl = document.getElementById('tv-msgs-inner');

    // Fetch from Gmail thread API
    const messages = await fetchMessages(inquiry.threadId);

    if (messages && messages.length) {
      renderThread(msgsEl, messages);
    } else if (inquiry.raw_email) {
      // Graceful fallback: render raw_email as single inbound bubble
      const ef = inquiry.extracted_fields || {};
      renderThread(msgsEl, [{
        id: inquiry.messageId || 'raw-0',
        direction: 'inbound',
        channel: 'email',
        from: inquiry.from || '',
        fromName: ef.customer_name || inquiry.from || '',
        to: 'info@blusbarbeque.com',
        subject: inquiry.subject || '',
        date: inquiry.date || inquiry.created_at || new Date().toISOString(),
        body: inquiry.raw_email.body || '',
        attachments: [],
      }]);
    } else {
      if (msgsEl) msgsEl.innerHTML = '<div class="tv-empty">No email messages found for this inquiry.</div>';
    }
  }

  function destroy() {
    _containerId = null;
    _inquiry = null;
    _pendingAttachments = [];
  }

  window.threadView = { init, destroy };
})();
