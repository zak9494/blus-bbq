#!/usr/bin/env node
// Extract all inline <script> blocks from index.html and syntax-check with Node.
// Run: node scripts/lint.js   OR   npm run lint
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const htmlPath = path.join(__dirname, '..', 'index.html');
const tmpPath  = path.join(os.tmpdir(), 'blus-bbq-combined.js');

if (!fs.existsSync(htmlPath)) {
  console.error('❌  index.html not found at', htmlPath);
  process.exit(1);
}

const html   = fs.readFileSync(htmlPath, 'utf8');
const parts  = html.split('<script');
const chunks = [];

for (const part of parts.slice(1)) {
  // Skip external scripts
  const attrs = part.slice(0, part.indexOf('>'));
  if (/src\s*=/.test(attrs)) continue;

  const start = part.indexOf('>') + 1;
  const end   = part.indexOf('</script>');
  if (end >= 0) chunks.push(part.slice(start, end));
}

const combined = chunks.join('\n');
fs.writeFileSync(tmpPath, combined);

console.log(`Checking ${chunks.length} script block(s), ${combined.length.toLocaleString()} chars…`);

try {
  execSync(`node --check "${tmpPath}"`, { stdio: 'inherit' });
  console.log('✅  JS syntax OK');
} catch {
  console.error('❌  Syntax error detected — see above');
  process.exit(1);
}
