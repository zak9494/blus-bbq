'use strict';

// Regression guard for the "missing inbound emails" bug Zach hit on the Amy
// thread (2026-04-25). Root cause: the Gmail thread API returned Amy's HTML-only
// reply with body=""; the iMessage-style bubble rendered empty so it looked like
// inbound was missing.
//
// These tests pin the body extractor to:
//   1. extract single-part plain bodies
//   2. prefer text/plain in multipart/alternative
//   3. fall back to (stripped) text/html when no text/plain part exists
//   4. recurse through nested multipart/mixed → multipart/alternative
//   5. handle the Apple-Mail HTML-only shape that triggered the live bug

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getBodyText, htmlToText, parseMessage } = require('./thread.js');

const b64u = (s) => Buffer.from(s, 'utf-8').toString('base64url');

describe('getBodyText', () => {
  it('returns "" for null/undefined payload', () => {
    assert.equal(getBodyText(null), '');
    assert.equal(getBodyText(undefined), '');
  });

  it('extracts a single-part text/plain body', () => {
    const payload = { mimeType: 'text/plain', body: { data: b64u('Hi Zach,\nThanks!') } };
    assert.equal(getBodyText(payload), 'Hi Zach,\nThanks!');
  });

  it('prefers text/plain over text/html in multipart/alternative', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64u('Plain wins') } },
        { mimeType: 'text/html',  body: { data: b64u('<p>HTML loses</p>') } },
      ],
    };
    assert.equal(getBodyText(payload), 'Plain wins');
  });

  it('falls back to text/html when no text/plain is present (regression: Amy reply was HTML-only)', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64u('<p>Hello there</p>') } },
      ],
    };
    const out = getBodyText(payload);
    assert.match(out, /Hello there/);
    assert.doesNotMatch(out, /<p>/);
  });

  it('handles the Apple-Mail single-part text/html shape (the actual Amy live payload)', () => {
    // Apple Mail / iCloud often sends a top-level text/html with body.data inline,
    // no parts. The pre-fix getBodyText returned "" for this shape.
    const html = '<html class="apple-mail-supports-explicit-dark-mode">'
      + '<head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head>'
      + '<body dir="auto">Hi Zach,<div><br></div><div>Here is what we want to order.</div></body></html>';
    const payload = { mimeType: 'text/html', body: { data: b64u(html) } };
    const out = getBodyText(payload);
    assert.match(out, /Hi Zach,/);
    assert.match(out, /Here is what we want to order\./);
    assert.doesNotMatch(out, /<html/);
    assert.doesNotMatch(out, /<head>/);
  });

  it('recurses through nested multipart (mixed → alternative)', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64u('Nested plain text') } },
          ],
        },
        { mimeType: 'application/pdf', filename: 'quote.pdf', body: { size: 1024, attachmentId: 'a1' } },
      ],
    };
    assert.equal(getBodyText(payload), 'Nested plain text');
  });

  it('returns "" when no text parts exist anywhere', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'application/pdf', filename: 'x.pdf', body: { size: 100 } },
      ],
    };
    assert.equal(getBodyText(payload), '');
  });
});

describe('htmlToText', () => {
  it('converts <br> to newlines', () => {
    assert.equal(htmlToText('a<br>b<br/>c'), 'a\nb\nc');
  });

  it('strips style/script/head blocks', () => {
    const html = '<head><style>.x{color:red}</style></head><body>visible</body>';
    assert.equal(htmlToText(html), 'visible');
  });

  it('decodes the most common entities', () => {
    assert.equal(htmlToText('Tom&nbsp;&amp;&nbsp;Jerry &lt;3'), 'Tom & Jerry <3');
  });

  it('collapses runs of blank lines', () => {
    const out = htmlToText('<p>a</p><p></p><p></p><p></p><p>b</p>');
    assert.doesNotMatch(out, /\n{3,}/);
    assert.match(out, /a\n\nb/);
  });
});

describe('parseMessage direction (regression: classification must not depend on case)', () => {
  const mkMsg = (fromHeader) => ({
    id: 'm1',
    payload: {
      headers: [
        { name: 'From', value: fromHeader },
        { name: 'To',   value: 'someone@example.com' },
        { name: 'Date', value: 'Fri, 25 Apr 2026 16:41:23 -0500' },
        { name: 'Subject', value: 'Re: Catering' },
      ],
    },
  });

  it('classifies info@blusbarbeque.com as outbound', () => {
    assert.equal(parseMessage(mkMsg('Zach B <info@blusbarbeque.com>')).direction, 'outbound');
  });

  it('classifies INFO@BlusBarbeque.com as outbound (case-insensitive)', () => {
    assert.equal(parseMessage(mkMsg('Zach <INFO@BlusBarbeque.com>')).direction, 'outbound');
  });

  it('classifies a customer address as inbound', () => {
    assert.equal(parseMessage(mkMsg('Amy Brickert <abrickert@sbcglobal.net>')).direction, 'inbound');
  });
});
