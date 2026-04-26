'use strict';

// Conventional Commits config — enforced via .husky/commit-msg.
//
// Format: <type>(<scope>): <subject>
//   feat(kanban): add lost-reasons widget
//   fix(notifications): clear stale push subscription on 410
//   chore(status): refresh dashboard
//
// Types reflect what we already use (see git log). `hotfix` is added because
// Wave Shepherd cron treats it as a P0 priority signal.

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'hotfix',
        'chore',
        'docs',
        'test',
        'refactor',
        'perf',
        'build',
        'ci',
        'revert',
        'style',
        'qa',
      ],
    ],
    // Subject line up to 100 chars to fit our existing style.
    'subject-max-length': [2, 'always', 100],
    // Allow lower-case, sentence-case, start-case — the existing log mixes
    // emoji + en-dashes + descriptive prose, and forcing one case would
    // reject reasonable messages.
    'subject-case': [0],
    // Body line wrapping is generous — paste full incident-context blocks.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
