# CI speed-up plan

This plan is self-contained. You don't need any prior context about the repo or earlier discussions.

## Background

- Repo: `SukuWc/fields` (SailZone, a browser sailing-race simulator with a Node multiplayer server). Node 22, ESM, npm.
- Team workflow: every change is a feature branch, then a PR to `main`, then a squash-merge. Branches are kept current by **merging** `main` into them. Never rebase or force-push.
- CI is GitHub Actions. There are three workflow files in `.github/workflows/`:
  - `test.yml` ("Test"): this plan changes it.
  - `main.yml`: production Pages deploy on push to main. **Do not change.**
  - `preview.yml`: per-PR preview deploy. **Do not change.**
- Editing workflow files needs a GitHub token with the `workflow` scope.

## Current state of `test.yml`

- Triggers: `push` (every branch, `paths-ignore: ['README.md']`) and `pull_request` (no path filter).
- Concurrency: `group: test-${{ github.ref }}`, `cancel-in-progress: true`.
- Jobs, each on `ubuntu-latest` (4 vCPU):
  - `test`: `npm ci`, `npm run build`, `npm test`. Takes about 4 min. It was already made parallel in PR #143, so leave it alone.
  - `scenario-checks`: `npm ci`, `npm run build`, then a **serial** shell loop over `scripts/*-check.mjs`. Each check runs as `node --import ./test/register.mjs "$f"`, printing an error and recording a failure if one fails. Takes about **11 min**, which makes it the bottleneck. The slowest checks are `budget-check` (about 143 s), `amr-auto` (about 87 s) and `fast-wind` (about 83 s).
  - `server-smoke`: `npm run build:server`, `npm run smoke:server`. It's short, so leave it alone.
- `scripts/check-all.mjs` (run with `npm run check:all`) already does the same as the shell loop: run every `scripts/*-check.mjs` with `--import ./test/register.mjs`, print `PASS`/`FAIL name (N s)`, show the last 30 lines of output on failure, and exit 1 if anything failed. It also runs them **serially**, using `spawnSync`.

Total wall time today is about 11.5 min, set by `scenario-checks`. The target is about 3–4 min.

## Change 1: run scenario checks in parallel

1. In `scripts/check-all.mjs`, replace the serial `spawnSync` loop with an async worker pool that uses `child_process.spawn`:
   - Concurrency = `Number(process.env.CHECK_CONCURRENCY) || os.availableParallelism()`.
   - Start checks **longest first**, using a hard-coded list of known slow names at the front (`budget-check`, `amr-auto-check`, `fast-wind-check`) with the rest alphabetical, so the slowest check doesn't start last.
   - Buffer each child's stdout and stderr, and print them only when that child finishes, so parallel output doesn't interleave. Keep the existing `PASS/FAIL name (N s)` line, the last-30-lines output on failure, the `X/Y checks passed` summary, and exit code 1 on any failure.
2. In `.github/workflows/test.yml`, job `scenario-checks`, replace the whole `for f in scripts/*-check.mjs ... exit $fail` step with:
   ```yaml
   - name: Scenario checks
     env:
       CHECK_CONCURRENCY: 4
     run: npm run check:all
   ```
3. Risk: some checks may compare against wall-clock time and fail under CPU contention. That already happened once with a unit test, `slow-client`, which now runs serially as `test/slow-client.timing.mjs`. If a check passes alone but fails in the pool, add it to a `SERIAL` list in `check-all.mjs` that runs after the pool finishes. Don't loosen its assertions.

## Change 2: run push only on main

In `test.yml`:
```yaml
on:
  push:
    branches: [main]
    paths-ignore: [...see Change 3...]
  pull_request:
    paths-ignore: [...see Change 3...]
```
Why: today every push to a branch with an open PR starts **two** full Test runs, one for `push` and one for `pull_request`. Their `github.ref` values differ (`refs/heads/x` vs `refs/pull/N/merge`), so the concurrency group never cancels either one. PR branches are still fully tested by `pull_request`, and `main` is still tested on push.

## Change 3: skip docs-only changes

Use the same list for both triggers:
```yaml
paths-ignore:
  - '**/*.md'
  - 'docs/**'
  - 'brand-kit/**'
```
Caveat: if "Test" (or one of its jobs) is a **required status check** in branch protection for `main`, a docs-only PR will wait forever for a check that never runs. Check this under repo Settings, then Branches. If it is required, don't use `paths-ignore`. Use a `dorny/paths-filter` step, or a tiny always-passing job with the same name, so the check reports success.

## Do not change

- The `test` and `server-smoke` jobs, `package.json` scripts other than what Change 1 needs, `main.yml` and `preview.yml`.
- Test assertions and pinned values.

## Verification

1. Run `npm ci && npm run build && npm run check:all` locally: all checks pass, and the wall time is clearly lower than before (log both numbers).
2. Run `CHECK_CONCURRENCY=1 npm run check:all`: it still passes, which proves the serial path works.
3. Open the PR: exactly **one** Test run per push, and `scenario-checks` under about 4 min.
4. Optionally, open a README-only test PR to confirm Test does not run (or reports success, if the required-check workaround is used), then close it.

## When done

- Add a line under the fitting phase of `README.md` `## Roadmap`: `[ ]` with a link to the PR while it's open, `[x]` once merged. Bump "Last updated". Don't move other lines.
- Report the before and after times for `scenario-checks` and for the whole workflow in the PR description.
