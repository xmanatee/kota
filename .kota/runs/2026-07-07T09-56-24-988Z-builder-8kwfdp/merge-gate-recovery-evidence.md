# Merge-Gate Recovery Evidence

Target run: `2026-07-07T06-33-49-256Z-builder-79nvwh`

The blocked branch commit `e5f93ac12d682b786a0cd0e514a801d9ed9c6d99`
contained the shadow semantic-review implementation and had failed merge-gate
validation because the package test script used bare `--silent`, causing
appended path arguments to be parsed as `--silent=src/modules/git`.

Recovery performed in this branch:

- Applied the target branch changes from merge base
  `f875c2a8812c5abaed45a065a11e5484de83a0c1` onto current head.
- Kept the later recovery/progress commits already on `main`.
- Corrected `package.json` so `pnpm test <paths>` expands to
  `vitest run --configLoader runner --silent=true <paths>`.
- Preserved the run artifacts from
  `.kota/runs/2026-07-07T06-33-49-256Z-builder-79nvwh/`.
- Left `task-run-shadow-semantic-reviewers-for-non-builder-auto` in `ready/`
  with a recovery note. The recovered branch content is staged here, but the
  canonical active claim for run `2026-07-07T06-33-49-256Z-builder-79nvwh`
  still reports `pending-merge` because the sandbox cannot write the canonical
  `.kota/task-claims` directory.

Validation:

- `pnpm test src/modules/git src/modules/autonomy/workflows/builder`
  passed: 26 files, 214 tests.
- `pnpm test src/modules/autonomy/shadow-semantic-review-runtime.test.ts src/modules/autonomy/shadow-semantic-review-blocking.test.ts src/modules/autonomy/workflows/inbox-sorter/workflow.test.ts src/modules/autonomy/workflows/research-retry/workflow.test.ts src/modules/autonomy/report/report-shadow-semantic-reviews.test.ts src/modules/autonomy/report/shadow-semantic-reviews.test.ts src/modules/autonomy/report/render.test.ts`
  passed: 6 files, 27 tests.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- `checkAutonomyChangeDecisionForRun(..., ./.kota/runs/2026-07-07T06-33-49-256Z-builder-79nvwh)`
  passed: the artifact covers 10 material autonomy files.
- `checkAutonomyChangeDecisionForRun(..., ./.kota/runs/2026-07-07T09-56-24-988Z-builder-8kwfdp)`
  passed: the current repair-run artifact covers the staged material autonomy
  files.
- `checkSevereSourceFileSizeForRun(..., ./.kota/runs/2026-07-07T06-33-49-256Z-builder-79nvwh)`
  returned advisory warnings for `src/daemon.integration.test.ts`,
  `src/modules/autonomy/workflows/research-retry/workflow.test.ts`, and
  `src/workflow-runtime.integration.test.ts`.
- `node --import tsx src/validate-queue.ts --min-ready 0` passed against the
  temporary staged view.
- `releaseTaskClaim` against the canonical checkout failed with `EPERM` while
  opening
  `/Users/xmanatee/Desktop/mono/apps/kota/.kota/task-claims/active/task-run-shadow-semantic-reviewers-for-non-builder-auto.json`;
  see `claim-release-attempt.json`. This recovery task is therefore blocked on
  operator-captured canonical claim release instead of marked done.

Linked-worktree note:

The real Git index and object store for this linked worktree live under the
canonical checkout's `.git/worktrees/...`, outside this sandbox's writable
roots. Commands that write the real index, including `git add` and task CLI
`git mv` staging, can fail with `Operation not permitted`. A writable temporary
index/object store was used only for validation evidence where needed. After
the worktree files were complete, `git add -A` staged the final diff in the
real index.
