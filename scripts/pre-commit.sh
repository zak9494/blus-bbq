#!/bin/sh
# Blu's BBQ pre-commit hook — blocks commits with JS syntax errors in index.html.
#
# Install once:
#   npm run install-hooks
# Or manually:
#   cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

# Only run when index.html is staged
if ! git diff --cached --name-only | grep -q 'index\.html'; then
  exit 0
fi

echo "🔍  Running JS syntax check on index.html…"
node scripts/lint.js
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "❌  Commit blocked: fix the syntax error above, then re-commit."
  exit 1
fi

exit 0
