# Builder Dead-Letter Resolution

## Cited Items

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6`
  - Canonical state read during this run: `open`
  - Failure reason: `Agent step "build" idle timed out after 3600000ms without runtime progress`
  - Failed run: `2026-06-29T18-19-41-973Z-builder-qonf80`
  - Claimed task: `task-resolve-current-progress-reviewer-write-scope-dead`
  - Outcome: the failed worktree had no tracked task progress except an untracked `node_modules/` directory. Later builder run `2026-06-30T19-53-51-915Z-builder-ggdpuf` replaced the stale claim, completed the same task, and merged `8cef38bb177119e4ca81e219190324e0d052207e`.
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28`
  - Canonical state read during this run: `open`
  - Failure reason: `Repair loop for step "build" made no progress after 3 consecutive attempts. Still failing: commit-stageable`
  - Failed run: `2026-06-30T15-16-48-125Z-builder-3usmop`
  - Claimed task: `task-security-review-the-task-move-path-accepts-unvalid`
  - Outcome: the abandoned task worktree contained valid tracked changes, but `checkCommitStageable` failed on a stale Git index lock at `.git/worktrees/task-security-review-the-task-move-path-accepts-unvalid-2026-06-30t15-16-48-125z-builder-3usmop/index.lock`. The previous repair check labeled all nonzero dry-run staging failures as path/gitignore conflicts, so the repair loop had no useful action.

## Repair

`src/modules/autonomy/commit.ts` now wraps `checkCommitStageable`'s `git add --dry-run -A -- <paths>` call in the same Git index-lock retry helper used by the terminal staging and commit paths. Transient locks clear without failing the repair loop. Persistent locks now throw a specific message telling the agent to remove the stale lock or wait for the other Git process, instead of claiming a gitignore/path conflict.

`src/modules/autonomy/commit.test.ts` adds a repair-check regression test that creates `.git/index.lock`, removes it shortly afterward, and verifies `checkCommitStageable` returns `OK: 1 mutated path(s) stageable`.

## Canonical DLQ Mutation

The canonical DLQ file is outside this worktree's writable roots:

- Direct source-mode CLI dismissal from `/Users/xmanatee/Desktop/mono/apps/kota` failed with `EPERM` while opening `/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json.tmp`.
- Daemon control is listening on the canonical control port, but Node HTTP access from this active builder sandbox failed with `connect EPERM 127.0.0.1:53978`.

Because this run could not honestly dismiss the canonical records, it created `task-clear-stale-builder-dlq-items-after-repair-merge` to clear, redrive, or explicitly suppress both stale ids once canonical write or daemon-control access is available.

## Validation

- Passed: `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/commit.test.ts src/modules/autonomy/commit-paths.test.ts`
- Passed: `pnpm run typecheck`
