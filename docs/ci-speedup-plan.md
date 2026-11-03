# CI speed-up plan

Goal: cut the Test workflow from about 11.5 min to about 3 min. The test job is already about 4 min after #143. `scenario-checks` (about 11 min, serial) is now the bottleneck.

## 1. Run scenario checks in parallel

- `scripts/check-all.mjs`: replace the serial `spawnSync` loop with an async pool (`spawn`). Default concurrency is `os.availableParallelism()`, which can be overridden by a `CHECK_CONCURRENCY` env var. Keep the PASS/FAIL line per check, its timing, and the last 30 lines of output on failure. Exit nonzero if any check fails.
- `.github/workflows/test.yml`, job `scenario-checks`: replace the `for f in scripts/*-check.mjs` shell loop with `npm run check:all`. Optionally set `CHECK_CONCURRENCY: 4` (GitHub runners have 4 vCPUs).
- Watch for wall-clock-sensitive checks. Like `slow-client` in #143, they may need to run serially after the rest.
- Expected: about 11 min down to about 3 min. The longest single check is `budget-check` at about 143 s.

## 2. Run push only on main

- `.github/workflows/test.yml`: add `branches: [main]` under `on.push`.
- Why: PR branches currently run the full suite twice per push, once for `push` and once for `pull_request`, because the `test-${{ github.ref }}` concurrency group differs between the two events. Commits to PR branches are still covered by `pull_request`.

## 3. Skip docs-only changes

- `.github/workflows/test.yml`: use the same `paths-ignore` for both `push` and `pull_request`:
  `['**/*.md', 'docs/**', 'brand-kit/**']`
- Caveat: if `test` is a required status check in branch protection, a skipped workflow leaves docs-only PRs waiting forever. Either don't require it, or add a tiny no-op job instead of `paths-ignore`.

## Files touched

- `.github/workflows/test.yml` (all three changes; needs a token with `workflow` scope)
- `scripts/check-all.mjs` (parallel pool)

## Verification

- Run `npm run check:all` locally and confirm every check passes and the wall time drops.
- Open a PR and confirm only one Test run per push and `scenario-checks` under about 4 min.
- Open a README-only PR and confirm Test does not run.
