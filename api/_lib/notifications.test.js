'use strict';
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.KV_REST_API_URL   = 'https://mock-kv.example.com';
process.env.KV_REST_API_TOKEN = 'mock-token';

// ── KV mock ───────────────────────────────────────────────────────────────────
// Supports: GET (direct), pipeline SET/GET/DEL/INCR/DECR/ZADD/ZREM/ZREVRANGE
const https = require('https');
const _kv  = {};          // key → string (simple store)
const _zsets = {};        // key → Map<member, score> (sorted sets)

function clearStore() {
  Object.keys(_kv).forEach(k => delete _kv[k]);
  Object.keys(_zsets).forEach(k => delete _zsets[k]);
}

function execCmd(cmd) {
  const [op, ...args] = cmd;
  switch (op) {
    case 'SET':   _kv[args[0]] = args[1]; return { result: 'OK' };
    case 'GET':   return { result: Object.prototype.hasOwnProperty.call(_kv, args[0]) ? _kv[args[0]] : null };
    case 'DEL':   { const existed = args[0] in _kv; delete _kv[args[0]]; return { result: existed ? 1 : 0 }; }
    case 'INCR':  { const n = parseInt(_kv[args[0]] || '0', 10) + 1; _kv[args[0]] = String(n); return { result: n }; }
    case 'DECR':  { const n = parseInt(_kv[args[0]] || '0', 10) - 1; _kv[args[0]] = String(n); return { result: n }; }
    case 'ZADD':  {
      const [key, score, member] = args;
      if (!_zsets[key]) _zsets[key] = new Map();
      _zsets[key].set(member, Number(score));
      return { result: 1 };
    }
    case 'ZREM':  {
      const [key, member] = args;
      const existed = _zsets[key] && _zsets[key].has(member);
      if (_zsets[key]) _zsets[key].delete(member);
      return { result: existed ? 1 : 0 };
    }
    case 'ZREVRANGE': {
      const [key, start, stop] = args;
      if (!_zsets[key]) return { result: [] };
      const sorted = [..._zsets[key].entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([m]) => m);
      const s = parseInt(start, 10);
      const e = stop === -1 || stop === '-1' ? sorted.length : parseInt(stop, 10) + 1;
      return { result: sorted.slice(s, e) };
    }
    default: return { result: null };
  }
}

function mockRequest(opts, cb) {
  const path   = typeof opts === 'string' ? opts : (opts.path || '');
  const method = typeof opts === 'object' ? (opts.method || 'GET') : 'GET';
  const bodyChunks = [];

  const res = {
    statusCode: 200,
    on(event, handler) {
      if (event === 'data') res._dataHandler = handler;
      if (event === 'end')  res._endHandler  = handler;
      return res;
    },
    resume() { return res; },
  };

  const req = {
    write(chunk) { bodyChunks.push(chunk); },
    end() {
      let responseBody;
      if (method === 'GET') {
        const m = path.match(/\/get\/([^?]+)/);
        if (m) {
          const key = decodeURIComponent(m[1]);
          const val = Object.prototype.hasOwnProperty.call(_kv, key) ? _kv[key] : null;
          responseBody = JSON.stringify({ result: val });
        } else {
          responseBody = JSON.stringify({ result: null });
        }
      } else {
        // POST /pipeline
        let cmds = [];
        try { cmds = JSON.parse(bodyChunks.join('')); } catch { cmds = []; }
        const results = Array.isArray(cmds) ? cmds.map(execCmd) : [];
        responseBody = JSON.stringify(results);
      }
      if (cb) cb(res);
      if (res._dataHandler) res._dataHandler(responseBody);
      if (res._endHandler)  res._endHandler();
    },
    on() { return req; },
  };
  return req;
}

https.request = mockRequest;

// ── Module under test ─────────────────────────────────────────────────────────
const {
  createNotification, listNotifications, getNotification,
  markRead, markAllRead, dismissNotification,
  deleteNotification, getUnreadCount,
} = require('./notifications.js');

// ── createNotification ────────────────────────────────────────────────────────
describe('createNotification', () => {
  beforeEach(clearStore);

  it('returns a record with correct shape', async () => {
    const n = await createNotification({ type: 'customer_reply', title: 'New reply' });
    assert.ok(n.id.startsWith('notif_'));
    assert.equal(n.type, 'customer_reply');
    assert.equal(n.title, 'New reply');
    assert.equal(n.read, false);
    assert.equal(n.dismissed, false);
    assert.ok(n.createdAt);
  });

  it('applies defaults for optional fields', async () => {
    const n = await createNotification({ type: 'quote_sent', title: 'Quote ready' });
    assert.equal(n.severity, 'medium');
    assert.equal(n.sound, 'default');
    assert.equal(n.icon, 'bell');
    assert.equal(n.body, '');
    assert.equal(n.customerId, null);
    assert.equal(n.inquiryId, null);
    assert.deepEqual(n.metadata, {});
  });

  it('stores record in KV so getNotification finds it', async () => {
    const n = await createNotification({ type: 'event_today', title: 'Event today!' });
    const fetched = await getNotification(n.id);
    assert.ok(fetched);
    assert.equal(fetched.id, n.id);
    assert.equal(fetched.type, 'event_today');
  });

  it('increments unread_count', async () => {
    await createNotification({ type: 'follow_up_due', title: 'A' });
    await createNotification({ type: 'follow_up_due', title: 'B' });
    const count = await getUnreadCount();
    assert.equal(count, 2);
  });

  it('throws when type or title is missing', async () => {
    await assert.rejects(() => createNotification({ title: 'No type' }));
    await assert.rejects(() => createNotification({ type: 'foo' }));
  });
});

// ── listNotifications ─────────────────────────────────────────────────────────
describe('listNotifications', () => {
  beforeEach(clearStore);

  it('returns empty list when no notifications exist', async () => {
    const result = await listNotifications();
    assert.deepEqual(result.notifications, []);
    assert.equal(result.total, 0);
    assert.equal(result.unread_count, 0);
  });

  it('returns notifications in newest-first order', async () => {
    const a = await createNotification({ type: 'quote_sent',  title: 'First' });
    const b = await createNotification({ type: 'event_today', title: 'Second' });
    const { notifications } = await listNotifications();
    assert.equal(notifications[0].id, b.id);
    assert.equal(notifications[1].id, a.id);
  });

  it('filters by unread_only', async () => {
    const a = await createNotification({ type: 'quote_sent', title: 'A' });
    await createNotification({ type: 'quote_sent', title: 'B' });
    await markRead(a.id);
    const { notifications, total } = await listNotifications({ unread_only: true });
    assert.equal(total, 1);
    assert.equal(notifications[0].read, false);
  });

  it('filters by type', async () => {
    await createNotification({ type: 'quote_sent',  title: 'Q' });
    await createNotification({ type: 'event_today', title: 'E' });
    const { notifications, total } = await listNotifications({ type: 'event_today' });
    assert.equal(total, 1);
    assert.equal(notifications[0].type, 'event_today');
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification({ type: 'follow_up_due', title: 'N' + i });
    }
    const page1 = await listNotifications({ limit: 2, offset: 0 });
    const page2 = await listNotifications({ limit: 2, offset: 2 });
    assert.equal(page1.notifications.length, 2);
    assert.equal(page2.notifications.length, 2);
    assert.notEqual(page1.notifications[0].id, page2.notifications[0].id);
  });

  it('reports unread_count correctly', async () => {
    await createNotification({ type: 'follow_up_due', title: 'A' });
    await createNotification({ type: 'follow_up_due', title: 'B' });
    const { unread_count } = await listNotifications();
    assert.equal(unread_count, 2);
  });
});

// ── markRead ──────────────────────────────────────────────────────────────────
describe('markRead', () => {
  beforeEach(clearStore);

  it('sets read=true and readAt', async () => {
    const n = await createNotification({ type: 'customer_reply', title: 'Hello' });
    const updated = await markRead(n.id);
    assert.equal(updated.read, true);
    assert.ok(updated.readAt);
  });

  it('decrements unread_count', async () => {
    const n = await createNotification({ type: 'deposit_overdue', title: 'Pay up' });
    assert.equal(await getUnreadCount(), 1);
    await markRead(n.id);
    assert.equal(await getUnreadCount(), 0);
  });

  it('is idempotent — does not double-decrement', async () => {
    const n = await createNotification({ type: 'deposit_overdue', title: 'Pay up' });
    await markRead(n.id);
    await markRead(n.id); // second call
    const count = await getUnreadCount();
    assert.ok(count >= 0, 'count should not go negative');
  });

  it('returns null for unknown id', async () => {
    const result = await markRead('notif_nonexistent');
    assert.equal(result, null);
  });
});

// ── markAllRead ───────────────────────────────────────────────────────────────
describe('markAllRead', () => {
  beforeEach(clearStore);

  it('marks all unread notifications as read', async () => {
    await createNotification({ type: 'follow_up_due', title: 'A' });
    await createNotification({ type: 'follow_up_due', title: 'B' });
    const { updated } = await markAllRead();
    assert.equal(updated, 2);
    assert.equal(await getUnreadCount(), 0);
  });

  it('returns updated=0 when all are already read', async () => {
    const n = await createNotification({ type: 'quote_sent', title: 'Done' });
    await markRead(n.id);
    const { updated } = await markAllRead();
    assert.equal(updated, 0);
  });

  it('returns updated=0 when store is empty', async () => {
    const { updated } = await markAllRead();
    assert.equal(updated, 0);
  });
});

// ── dismissNotification ───────────────────────────────────────────────────────
describe('dismissNotification', () => {
  beforeEach(clearStore);

  it('sets dismissed=true and dismissedAt', async () => {
    const n = await createNotification({ type: 'event_tomorrow', title: 'Tomorrow!' });
    const updated = await dismissNotification(n.id);
    assert.equal(updated.dismissed, true);
    assert.ok(updated.dismissedAt);
  });

  it('returns null for unknown id', async () => {
    const result = await dismissNotification('notif_ghost');
    assert.equal(result, null);
  });
});

// ── deleteNotification ────────────────────────────────────────────────────────
describe('deleteNotification', () => {
  beforeEach(clearStore);

  it('removes the item and returns {deleted: true}', async () => {
    const n = await createNotification({ type: 'inquiry_needs_review', title: 'Review me' });
    const result = await deleteNotification(n.id);
    assert.equal(result.deleted, true);
    assert.equal(result.id, n.id);
    const fetched = await getNotification(n.id);
    assert.equal(fetched, null);
  });

  it('removes item from the list', async () => {
    const n = await createNotification({ type: 'inquiry_needs_review', title: 'Review me' });
    await deleteNotification(n.id);
    const { total } = await listNotifications();
    assert.equal(total, 0);
  });

  it('decrements unread_count when deleting unread', async () => {
    const n = await createNotification({ type: 'customer_reply', title: 'Hi' });
    assert.equal(await getUnreadCount(), 1);
    await deleteNotification(n.id);
    // count is decremented
    const count = parseInt(_kv['notifications:unread_count'] || '0', 10);
    assert.ok(count <= 0);
  });

  it('does NOT decrement count when deleting already-read item', async () => {
    const n = await createNotification({ type: 'quote_sent', title: 'Sent' });
    await markRead(n.id);
    const countBefore = await getUnreadCount();
    await deleteNotification(n.id);
    const countAfter = await getUnreadCount();
    assert.equal(countAfter, countBefore);
  });

  it('returns null for unknown id', async () => {
    const result = await deleteNotification('notif_gone');
    assert.equal(result, null);
  });
});
