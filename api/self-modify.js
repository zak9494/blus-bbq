const https = require('https');
const crypto = require('crypto');

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const TARGET_FILE   = 'index.html';
const TARGET_BRANCH = 'main';

/* ── Static module files (Rule 14) ──────────────────────────────────────────
   GET handler appends these as read-only context so the AI can see them.
   POST handler can write them back via <<<FILE: path>>> delimiters.
   Update this array whenever a new module file is added under /static/.
   ────────────────────────────────────────────────────────────────────────── */
const STATIC_MODULE_FILES = [
  'static/js/calendar.js',
  'static/css/calendar.css',
  'static/js/deposits.js',
  'static/css/deposits.css',
  'static/js/repeat-customer.js',
  'static/js/pipeline-alerts.js',
  'static/js/quote-revise.js',
  'api/calendar/_gcal.js',
  'api/calendar/list.js',
  'api/calendar/create.js',
  'api/calendar/update.js',
  'api/calendar/delete.js',
  'api/calendar/webhook.js',
  'api/calendar/watch-register.js',
  'api/calendar/watch-status.js',
  'api/cron/renew-calendar-watch.js',
  'api/deposits/list.js',
  'api/deposits/save.js',
  'api/pipeline/alerts.js',
  'api/inquiries/by-email.js',
  'api/inquiries/save.js',
];
const SECRET = process.env.SELF_MODIFY_SECRET || process.env.GITHUB_TOKEN || 'dev-fallback-secret';

const FORBIDDEN_PATTERNS = [
  { pattern: /\banync\s+function\b/, label: '"anync function" typo' },
  { pattern: /\banync\s*\(/, label: '"anync(" typo' },
  { pattern: /claude-sonnet-4-20250514/, label: 'invalid old model id' },
  { pattern: /claude-3-sonnet-2024/, label: 'deprecated model id' },
];
const REQUIRED_MARKERS = ['</body>', '</html>', '<script', '<style', 'function showPage'];
const MIN_LEN = 10 * 1024;
const MAX_LEN = 1 * 1024 * 1024;

function hmac(content) { return crypto.createHmac('sha256', SECRET).update(content).digest('hex'); }

function validateContent(content) {
  const errors = [];
  if (typeof content !== 'string') errors.push('content must be a string');
  if (content.length < MIN_LEN) errors.push(`content too short (${content.length} bytes, min ${MIN_LEN})`);
  if (content.length > MAX_LEN) errors.push(`content too large (${content.length} bytes, max ${MAX_LEN})`);
  for (const { pattern, label } of FORBIDDEN_PATTERNS) { if (pattern.test(content)) errors.push(`forbidden pattern: ${label}`); }
  for (const marker of REQUIRED_MARKERS) { if (!content.includes(marker)) errors.push(`missing required marker: ${marker}`); }
  return errors;
}

function lineDiff(oldStr, newStr) {
  const a = oldStr.split('\n'), b = newStr.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removed = a.slice(prefix, a.length - suffix), added = b.slice(prefix, b.length - suffix);
  const truncate = (arr, max) => arr.length > max ? arr.slice(0, max).concat([`... [${arr.length - max} more lines truncated]`]) : arr;
  return { oldLineCount: a.length, newLineCount: b.length, addedCount: added.length, removedCount: removed.length, netDelta: b.length - a.length, hunkStartLine: prefix + 1, contextBefore: a.slice(Math.max(0, prefix - 3), prefix), removed: truncate(removed, 200), added: truncate(added, 200), contextAfter: a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + 3)) };
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = { hostname: 'api.github.com', port: 443, path, method, headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'blus-bbq-dashboard', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), } };
    const req = https.request(options, (res) => { let chunks = ''; res.on('data', (c) => (chunks += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch { resolve({ status: res.statusCode, body: chunks }); } }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function _kvGet(key) { try { const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } }); return await r.json(); } catch(e) { return {}; } }
async function _kvSet(key, value) { try { await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: value }); } catch(e) {} }

async function logModHistory(title, status, sha, error) {
  try {
    const entry = { id: Date.now().toString(), title: (title || 'Dashboard update').slice(0, 200), status: status || 'done', sha: sha || null, error: error || null, timestamp: new Date().toISOString() };
    const hd = await _kvGet('modify-history');
    const hist = hd.result ? JSON.parse(hd.result) : [];
    hist.unshift(entry);
    if (hist.length > 50) hist.splice(50);
    await _kvSet('modify-history', JSON.stringify(hist));
  } catch(_e) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN is not set' });
  if (!GITHUB_REPO) return res.status(500).json({ error: 'GITHUB_REPO is not set' });

  if (req.method === 'GET') {
    try {
      const current = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${TARGET_FILE}?ref=${TARGET_BRANCH}`);
      if (current.status !== 200) return res.status(502).json({ error: 'could not fetch source', detail: current.body });
      let content = Buffer.from(current.body.content, 'base64').toString('utf-8');

      // Append static module files as read-only AI context (Rule 14)
      // The AI can reference these files and return updated versions using <<<FILE: path>>> delimiters.
      for (const filePath of STATIC_MODULE_FILES) {
        try {
          const fr = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${TARGET_BRANCH}`);
          if (fr.status === 200) {
            const fc = Buffer.from(fr.body.content, 'base64').toString('utf-8');
            content += `\n\n<<<FILE: ${filePath}\n${fc}\nEND FILE: ${filePath}>>>`;
          }
        } catch(_e) { /* non-fatal — file may not exist yet */ }
      }

      return res.status(200).json({ ok: true, content, sha: current.body.sha });
    } catch (err) { return res.status(500).json({ error: err && err.message || String(err) }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON body' }); } }
  body = body || {};

  const mode = body.mode || 'preview';
  const content = body.content;
  const prompt = (body.prompt || 'Dashboard update').toString().slice(0, 200);
  const commitMessage = (body.commitMessage || 'AI-assisted dashboard update').toString().slice(0, 200);

  if (typeof content !== 'string' || !content) return res.status(400).json({ error: 'content (string) is required' });

  const errors = validateContent(content);
  if (errors.length) {
    if (mode === 'apply') await logModHistory(`[GUARDRAIL FAIL] ${prompt}`, 'error', null, `Guardrail rejected: ${errors.slice(0, 3).join('; ')}`);
    return res.status(400).json({ error: 'guardrails rejected content', guardrailErrors: errors });
  }

  try {
    const current = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${TARGET_FILE}?ref=${TARGET_BRANCH}`);
    if (current.status !== 200) return res.status(500).json({ error: 'could not fetch current file', detail: current.body });
    const currentContent = Buffer.from(current.body.content, 'base64').toString('utf-8');
    const currentSha = current.body.sha;
    if (currentContent === content) return res.status(200).json({ ok: true, noop: true, message: 'content identical' });
    const diff = lineDiff(currentContent, content);
    const proposalToken = hmac(content);
    if (mode === 'preview') return res.status(200).json({ ok: true, mode: 'preview', proposalToken, diff, currentSha, commitMessage, guardrailErrors: [] });
    if (mode !== 'apply') return res.status(400).json({ error: 'mode must be "preview" or "apply"' });
    if (!body.proposalToken || body.proposalToken !== proposalToken) return res.status(400).json({ error: 'proposalToken missing or mismatch; call mode=preview first' });
    if (body.confirmed !== true) return res.status(400).json({ error: 'confirmed: true is required to apply' });

    // ── Parse multi-file response (Rule 14) ────────────────────────────────
    // Content may contain <<<FILE: path\n...\nEND FILE: path>>> blocks for module files.
    // Extract them and commit everything atomically via git tree API.
    const FILE_BLOCK_RE = /<<<FILE:\s*([^\n]+)\n([\s\S]*?)\nEND FILE:[^\n]*>>>/g;
    const extraFiles = []; // { path, content }
    let mainContent = content;

    // Strip FILE blocks from the main content, collect module file updates
    mainContent = content.replace(FILE_BLOCK_RE, function(_, filePath, fileContent) {
      const cleanPath = filePath.trim();
      // Only allow writes to known static module paths (safety check)
      if (STATIC_MODULE_FILES.includes(cleanPath)) {
        extraFiles.push({ path: cleanPath, content: fileContent });
      }
      return ''; // remove from main content
    }).trimEnd();

    // If main content got stripped to nothing, use original (no FILE blocks present)
    if (mainContent.length < 100) mainContent = content.replace(FILE_BLOCK_RE, '').trimEnd();

    if (extraFiles.length === 0) {
      // Single-file path (backwards-compatible): use simple PUT
      const update = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${TARGET_FILE}`, { message: commitMessage, content: Buffer.from(mainContent, 'utf-8').toString('base64'), sha: currentSha, branch: TARGET_BRANCH });
      if (update.status >= 300) {
        await logModHistory(`[COMMIT FAIL] ${prompt}`, 'error', null, `GitHub commit failed (${update.status})`);
        return res.status(500).json({ error: 'GitHub commit failed', detail: update.body });
      }
      const _sha = update.body.commit && update.body.commit.sha;
      await logModHistory(commitMessage, 'done', _sha || null, null);
      return res.status(200).json({ ok: true, success: true, mode: 'apply', commit: _sha, diff, filesWritten: [TARGET_FILE] });
    }

    // Multi-file path: git blob → tree → commit → update ref
    const refResp = await githubRequest('GET', `/repos/${GITHUB_REPO}/git/ref/heads/${TARGET_BRANCH}`);
    if (refResp.status !== 200) return res.status(500).json({ error: 'could not get branch ref' });
    const headSha  = refResp.body.object.sha;
    const commitR  = await githubRequest('GET', `/repos/${GITHUB_REPO}/git/commits/${headSha}`);
    const treeSha  = commitR.body.tree.sha;

    const allFiles = [{ path: TARGET_FILE, content: mainContent }, ...extraFiles];
    const treeEntries = await Promise.all(allFiles.map(async (f) => {
      const blobResp = await githubRequest('POST', `/repos/${GITHUB_REPO}/git/blobs`, {
        content: Buffer.from(f.content, 'utf-8').toString('base64'), encoding: 'base64'
      });
      if (blobResp.status !== 201) throw new Error(`Blob creation failed for ${f.path}: ${blobResp.status}`);
      return { path: f.path, mode: '100644', type: 'blob', sha: blobResp.body.sha };
    }));

    const newTree = await githubRequest('POST', `/repos/${GITHUB_REPO}/git/trees`, { base_tree: treeSha, tree: treeEntries });
    if (newTree.status !== 201) return res.status(500).json({ error: 'tree creation failed', detail: newTree.body });

    const newCommit = await githubRequest('POST', `/repos/${GITHUB_REPO}/git/commits`, {
      message: commitMessage, tree: newTree.body.sha, parents: [headSha]
    });
    if (newCommit.status !== 201) return res.status(500).json({ error: 'commit creation failed', detail: newCommit.body });

    const refUpdate = await githubRequest('PATCH', `/repos/${GITHUB_REPO}/git/refs/heads/${TARGET_BRANCH}`, { sha: newCommit.body.sha });
    if (refUpdate.status >= 300) {
      await logModHistory(`[COMMIT FAIL] ${prompt}`, 'error', null, `Ref update failed (${refUpdate.status})`);
      return res.status(500).json({ error: 'ref update failed', detail: refUpdate.body });
    }

    const _sha = newCommit.body.sha;
    await logModHistory(commitMessage, 'done', _sha, null);
    return res.status(200).json({ ok: true, success: true, mode: 'apply', commit: _sha, diff, filesWritten: allFiles.map(f => f.path) });
  } catch (err) { return res.status(500).json({ error: err && err.message || String(err) }); }
};
