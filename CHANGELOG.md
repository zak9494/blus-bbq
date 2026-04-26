# Changelog

All notable changes to this project are documented in this file. The format is driven by [Conventional Commits](https://www.conventionalcommits.org/) and generated automatically by `npm run release` (`standard-version`).

The first machine-generated section will appear below this header on the next release. Until then, see `git log --oneline` or [the GitHub commits page](https://github.com/zak9494/blus-bbq/commits/main) for history.

## How to cut a release

```bash
npm run release            # bumps version, regenerates CHANGELOG, creates a tag
npm run release -- --first-release   # very first release; no version bump
git push --follow-tags origin main
```

`standard-version` reads commit messages since the previous tag and groups them by type:

- **Features** ← `feat(scope):`
- **Bug Fixes** ← `fix(scope):` and `hotfix(scope):`
- **Performance** ← `perf(scope):`
- Other types appear collapsed under "Other changes"

If a commit message doesn't follow the convention, the `commit-msg` hook (PR 5) blocks the commit, so by construction every commit on `main` is changelog-eligible.
