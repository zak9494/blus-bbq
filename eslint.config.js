'use strict';

// ESLint v9+ flat config.
// Permissive on purpose — the goal is to catch syntax/typo bugs (undefined
// variables shadowed via `let`/`const`, broken rest spreads, etc.) without
// drowning the codebase in style warnings. Style is handled by Prettier.

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'tests/audit/post-merge-smoke-output/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node + browser + service-worker + test runtime — kitchen sink so we
        // do not have to maintain per-file env declarations across the repo.
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        global: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-undef': 'off',
    },
  },
];
