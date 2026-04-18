const https = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // expected format: owner/repo
const TARGET_FILE = 'index.html';
const TARGET_BRANCH = 'main';
const SECRET = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN || 'dev-fallback-secret';

// Patterns that must NEVER appear in committed content
const FORBIDDEN_PATTERNS = [
  { pattern: /\banync\s+function\b/, label: '"anync function" typo (should be "async function")' },
  { pattern: /\banync\s*\(/, label: '"anync(" typo' },
  { pattern: /claude-sonnet-4-20250514/, label: 'invalid old model id "claude-sonnet-4-20250514" (use "claude-sonnet-4-5")' },
  { pattern: /claude-3-sonnet-2024/, label: 'deprecated model id "claude-3-sonnet-2024..."' },
];

// Required structural markers
const REQUIRED_MARKERS = ['</body>', '</html>', '<script', '<style', 'function showPage'];

const MIN_LEN = 10 * 1024;        // 10 KB
const MAX_LEN = 1 * 1024 * 1024;  // 1 MB

function hmac(content) {
  return crypto.createHmac('sha256', SECRET).update(content).digest('hex');
}

function validateContent(content) {
  const errors = [];
  if (typeof content !== 'string') errors.push('content must be a string');
  if (content.length < MIN_LEN) errors.push(`content too short (${content.length} bytes, min ${MIN_LEN})`);
  if (content.length > MAX_LEN) errors.push(`content too large (${content.length} bytes, max ${MAX_LEN})`);
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) errors.push(`forbidden pattern: ${label}`);
  }
  for (const marker of REQUIRED_MARKERS) {
    if (!content.includes(marker)) errors.push(`missing required marker: ${marker}`);
  }
  return errors;
}

function lineDiff(oldStr, newStr) {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  // Truncate hunks for transport
  const truncate = (arr, max) => arr.length > max ? arr.slice(0, max).concat([`â¦ [${arr.length - max} more lines truncated]`]) : arr;
  return {
    oldLineCount: a.length,
    newLineCount: b.length,
    addedCount: added.length,
    removedCount: removed.length,
    netDelta: b.length - a.length,
    hunkStartLine: prefix + 1,
    contextBefore: a.slice(Math.max(0, prefix - 3), prefix),
    removed: truncate(removed, 200),
    added: truncate(added, 200),
    contextAfter: a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + 3)),
  };
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'blus-bbq-dashboard',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN is not set' });
  if (!GITHUB_REPO) return res.status(500).json({ error: 'GITHUB_REPO is not set' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON body' }); }
  }
  body = body || {};

  // Legacy-compat: `action:'update'` without explicit apply => return preview only.
  // Direct commits require mode:'apply' + proposalToken + confirmed:true.
  const mode = body.mode || 'preview';
  const content = body.content;
  const commitMessage = (body.commitMessage || 'AI-assisted dashboard update').toString().slice(0, 200);

  if (typeof content !== 'string' || !content) {
    return res.status(400).json({ error: 'content (string) is required' });
  }

  const errors = validateContent(content);
  if (errors.length) {
    return res.status(400).json({ error: 'guardrails rejected this content', guardrailErrors: errors });
  }

  try {
    // Always fetch current file to compute diff and get SHA
    const current = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${TARGET_FILE}?ref=${TARGET_BRANCH}`);
    if (current.status !== 200) {
      return res.status(500).json({ error: 'could not fetch current file from GitHub', detail: current.body });
    }
    const currentContent = Buffer.from(current.body.content, 'base64').toString('utf-8');
    const currentSha = current.body.sha;

    if (currentContent === content) {
      return res.status(200).json({ ok: true, noop: true, message: 'content identical, nothing to commit' });
    }

    const diff = lineDiff(currentContent, content);
    const proposalToken = hmac(content);

    if (mode === 'preview') {
      return res.status(200).json({
        ok: true,
        mode: 'preview',
        proposalToken,
        diff,
        currentSha,
        commitMessage,
        guardrailErrors: [],
      });
    }

    if (mode !== 'apply') {
      return res.status(400).json({ error: 'mode must be "preview" or "apply"' });
    }
    const expected = hmac(content);
    if (!body.proposalToken || body.proposalToken !== expected) {
      return res.status(400).json({ error: 'proposalToken missing or does not match content; call mode=preview first' });
    }
    if (body.confirmed !== true) {
      return res.status(400).json({ error: 'confirmed: true is required to apply' });
    }

    // mode === 'apply' â commit
    const update = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${TARGET_FILE}`, {
      message: commitMessage,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      sha: currentSha,
      branch: TARGET_BRANCH,
    });
    if (update.status >= 300) {
      return res.status(500).json({ error: 'GitHub commit failed', detail: update.body });
    }
    return res.status(200).json({
      ok: true,
      success: true,
      mode: 'apply',
      commit: update.body.commit && update.body.commit.sha,
      diff,
    });
  } catch (err) {
    return res.status(500).json({ error: err && err.message || String(err) });
  }
};
