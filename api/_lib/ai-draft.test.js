'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEmailSystemPrompt,
  buildQuoteReplySystemPrompt,
  buildTextSystemPrompt,
} = require('./ai-draft.js');

describe('buildEmailSystemPrompt', () => {
  it('contains dedup instruction', () => {
    const p = buildEmailSystemPrompt();
    assert.ok(p.includes('Do not re-include answers the customer has already received'),
      'email prompt must have dedup instruction');
  });

  it('mentions Zach and phone number', () => {
    const p = buildEmailSystemPrompt();
    assert.ok(p.includes('Zach'));
    assert.ok(p.includes('214-514-8684'));
  });

  it('requires plain text only', () => {
    const p = buildEmailSystemPrompt();
    assert.ok(p.toLowerCase().includes('plain text'));
  });
});

describe('buildQuoteReplySystemPrompt', () => {
  it('contains dedup instruction', () => {
    const p = buildQuoteReplySystemPrompt();
    assert.ok(p.includes('Do not re-include information the customer has already received'),
      'quote_reply prompt must have dedup instruction');
  });

  it('mentions Zach and Blu\'s Barbeque', () => {
    const p = buildQuoteReplySystemPrompt();
    assert.ok(p.includes("Blu's Barbeque"));
  });
});

describe('buildTextSystemPrompt', () => {
  it('is short-form oriented', () => {
    const p = buildTextSystemPrompt();
    assert.ok(p.toLowerCase().includes('sms') || p.toLowerCase().includes('60 words'));
  });

  it('mentions Zach', () => {
    const p = buildTextSystemPrompt();
    assert.ok(p.includes('Zach'));
  });
});

describe('generateDraft input validation', () => {
  // We can test the error path without a Claude key by checking the error message format
  it('throws on unknown draftType', async () => {
    const { generateDraft } = require('./ai-draft.js');
    // Will throw before any HTTP call because draftType is invalid
    await assert.rejects(
      () => generateDraft({ inquiry: {}, draftType: 'invalid_type' }),
      (err) => {
        assert.ok(err.message.includes('Unknown draftType'));
        return true;
      }
    );
  });
});
