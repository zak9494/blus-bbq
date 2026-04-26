#!/usr/bin/env node
/* eslint-disable no-console */
// Regenerate STATUS.md from sources of truth:
//   - ROADMAP.md (wave progress: count `- [x]` vs `- [ ]` per Wave heading)
//   - git log on the current branch (last-24h merged PRs)
//   - `gh pr list --state open` (red PRs >2h old → "Need your call")
// Preserves manually-curated sections (Right now / Your todo / Up next /
// Discussed) from the existing STATUS.md.
//
// Usage (preview):     node scripts/regenerate-status.js
// Usage (write file):  node scripts/regenerate-status.js > /tmp/x && mv /tmp/x STATUS.md
//
// IMPORTANT: do NOT redirect directly to STATUS.md (`> STATUS.md`) — shell
// truncates the target before node runs, and the script reads STATUS.md to
// preserve manually-curated sections. Always go through a temp file.
//
// No external deps — uses git/gh CLIs via child_process.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const STATUS_PATH = path.join(REPO_ROOT, 'STATUS.md');
const ROADMAP_PATH = path.join(REPO_ROOT, 'ROADMAP.md');

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
  } catch (e) {
    return '';
  }
}

function nowIsoMinute() {
  // 2026-04-26T18:42Z — minute precision matches existing format
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
  );
}

function relativeTime(epochSec) {
  const diff = Math.floor(Date.now() / 1000 - epochSec);
  if (diff < 60) return 'just now';
  if (diff < 600) return 'recent';
  if (diff < 3600) return `${Math.floor(diff / 60)}min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 86400 / 7)}w ago`;
}

function progressBar(pct) {
  const filled = Math.round(pct / 10);
  return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
}

// ---------- Wave progress ---------------------------------------------------

function parseWaveProgress(roadmap) {
  const waves = [];
  let cur = null;
  for (const line of roadmap.split('\n')) {
    const m = line.match(/^##\s+Wave\s+(\d+(?:\.\d+)?)\s+[—-]\s+(.+?)\s*$/);
    if (m) {
      if (cur) waves.push(cur);
      let name = m[2];
      // Strip trailing " (2/2 complete) ✓" or similar
      name = name.replace(/\s*\([^)]*\)\s*✓?\s*$/, '');
      name = name.replace(/\s*✓\s*$/, '');
      cur = { num: m[1], name: name.trim(), done: 0, total: 0 };
      continue;
    }
    // Stop at next non-Wave H2 (e.g. "## Recently shipped", "## Backlog")
    if (line.startsWith('## ') && cur) {
      waves.push(cur);
      cur = null;
      continue;
    }
    if (cur) {
      if (/^- \[x\]/i.test(line)) {
        cur.done += 1;
        cur.total += 1;
      } else if (/^- \[ \]/.test(line)) {
        cur.total += 1;
      }
    }
  }
  if (cur) waves.push(cur);
  return waves;
}

function renderWaveBlock(waves) {
  if (waves.length === 0) return '## Wave progress\n_(no waves found in ROADMAP.md)_';
  const NAME_WIDTH = 38;
  const lines = ['## Wave progress'];
  for (const w of waves) {
    const pct = w.total === 0 ? 0 : Math.round((w.done / w.total) * 100);
    const bar = progressBar(pct);
    const checkmark = pct === 100 ? ' ✓' : '';
    const label = `Wave ${w.num} · ${w.name}`.padEnd(NAME_WIDTH + 9);
    const pctStr = String(pct).padStart(3) + '%';
    lines.push(`${label}${bar} ${pctStr} ${w.done}/${w.total}${checkmark}`);
  }
  return lines.join('\n');
}

// ---------- Last 24h merges -------------------------------------------------

function getMerged24h() {
  // %H = hash, %at = author timestamp (epoch), %s = subject
  // We try main first; fall back to current branch (e.g. when running locally
  // before the branch is on origin yet).
  let out = sh('git log --since="24 hours ago" --pretty="%H|%at|%s" main 2>/dev/null');
  if (!out.trim()) {
    out = sh('git log --since="24 hours ago" --pretty="%H|%at|%s"');
  }
  const merges = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const firstPipe = line.indexOf('|');
    const secondPipe = line.indexOf('|', firstPipe + 1);
    if (firstPipe < 0 || secondPipe < 0) continue;
    const hash = line.slice(0, firstPipe);
    const ts = Number(line.slice(firstPipe + 1, secondPipe));
    const subj = line.slice(secondPipe + 1);
    const m = subj.match(/\(#(\d+)\)\s*$/);
    if (!m) continue; // only PR-merge commits
    const prNum = m[1];
    let title = subj.replace(/\s*\(#\d+\)\s*$/, '');
    // Strip conventional-commit prefix (feat:, fix(area):, chore(...): etc.)
    title = title.replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, '');
    merges.push({ hash, ts, pr: prNum, title, rel: relativeTime(ts) });
  }
  return merges;
}

function renderLast24h(merges) {
  const header = '## Last 24 hours';
  if (merges.length === 0) {
    return `${header}\n✅ Merged\n   _(no merges in the last 24 hours)_\n\n❌ Failed to merge\n   _(see Wave Shepherd cron output)_`;
  }
  const PR_WIDTH = 5;
  const TITLE_WIDTH = 50;
  const lines = merges.map((m) => {
    const prCol = `#${m.pr}`.padEnd(PR_WIDTH);
    const titleTrunc = m.title.length > TITLE_WIDTH ? m.title.slice(0, TITLE_WIDTH - 1) + '…' : m.title;
    const titleCol = titleTrunc.padEnd(TITLE_WIDTH);
    return `   ${prCol} ${titleCol} ~${m.rel}`;
  });
  return `${header}\n✅ Merged\n${lines.join('\n')}\n\n❌ Failed to merge\n   _(see Wave Shepherd cron output)_`;
}

// ---------- Need your call (red open PRs >2h old) --------------------------

function getRedOpenPrs() {
  const out = sh(
    'gh pr list --state open --limit 100 --json number,title,createdAt,statusCheckRollup'
  );
  if (!out.trim()) return [];
  let prs;
  try {
    prs = JSON.parse(out);
  } catch {
    return [];
  }
  const cutoff = Date.now() - 2 * 3600 * 1000;
  const red = [];
  for (const pr of prs) {
    const rolls = pr.statusCheckRollup || [];
    const isRed = rolls.some(
      (c) => c.conclusion === 'FAILURE' || c.state === 'FAILURE' || c.state === 'ERROR'
    );
    if (!isRed) continue;
    const created = new Date(pr.createdAt).getTime();
    if (!Number.isFinite(created) || created > cutoff) continue;
    red.push(pr);
  }
  // Most-recently-created first
  red.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return red;
}

function renderNeedYourCall(redPrs) {
  const header = '## Need your call (max 3)';
  if (redPrs.length === 0) {
    return `${header}\n_(no urgent blockers right now)_`;
  }
  const items = redPrs.slice(0, 3).map((pr) => {
    const ageHours = Math.floor((Date.now() - new Date(pr.createdAt)) / 3600000);
    return `- PR #${pr.number} red ${ageHours}h — ${pr.title}`;
  });
  return `${header}\n${items.join('\n')}`;
}

// ---------- Section preservation -------------------------------------------

function pickSection(md, headingName) {
  // Find the H2 whose text (minus trailing parens like "(max 5)") matches
  // headingName. Return that line + everything until the next H2 or EOF.
  const lines = md.split('\n');
  const out = [];
  let inSec = false;
  for (const line of lines) {
    if (/^## /.test(line)) {
      const headTxt = line.replace(/^## /, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (inSec) break; // hit next H2; stop
      if (headTxt === headingName) {
        inSec = true;
        out.push(line);
        continue;
      }
    }
    if (inSec) out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

// ---------- Main ------------------------------------------------------------

function main() {
  const existing = fs.existsSync(STATUS_PATH) ? fs.readFileSync(STATUS_PATH, 'utf8') : '';
  const roadmap = fs.existsSync(ROADMAP_PATH) ? fs.readFileSync(ROADMAP_PATH, 'utf8') : '';

  const updated = nowIsoMinute();
  const waves = parseWaveProgress(roadmap);
  const merges = getMerged24h();
  const redPrs = getRedOpenPrs();

  const rightNow =
    pickSection(existing, 'Right now') || '## Right now (max 5)\n_(no active work)_';
  const yourTodo =
    pickSection(existing, 'Your todo') ||
    '## Your todo (action when ready)\n_(nothing pending)_';
  const upNext =
    pickSection(existing, 'Up next in queue') || '## Up next in queue (max 5)\n_(empty)_';
  const discussed =
    pickSection(existing, 'Discussed, not queued') ||
    '## Discussed, not queued (max 10)\n_(empty)_';

  const needCall = renderNeedYourCall(redPrs);
  const last24 = renderLast24h(merges);
  const waveBlock = renderWaveBlock(waves);

  const output =
    [
      "# Blu's BBQ — Status",
      '',
      `_Updated: ${updated}_`,
      '',
      rightNow,
      '',
      needCall,
      '',
      yourTodo,
      '',
      last24,
      '',
      upNext,
      '',
      discussed,
      '',
      waveBlock,
      '',
      '---',
      '[Full ROADMAP](./ROADMAP.md) · [Recently shipped](./ROADMAP.md#recently-shipped)',
    ].join('\n') + '\n';

  process.stdout.write(output);
}

main();
