---
status: done
---

# Recover stale builder claim blocking the daemon-backed TUI task

## Problem

    Recent builder dispatches found the P1 daemon-backed TUI task actionable but skipped it because task-replace-readline-navigator-with-a-real-daemon-back is still claimed by builder run 2026-07-06T15-29-18-209Z-builder-njj4hw. That referenced build was interrupted, so release, expire, or correctly resume the stale claim and let the task be retried.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-06T18-04-40-124Z-progress-reviewer-j2c2j6.

## Resolution

The task-claim recovery path now reads the active claim owner's workflow run
metadata. A claim that still has an unexpired time lease is treated as retryable
when its owner run already ended with `failed` or `interrupted`, so a later
builder claim replaces the abandoned claim instead of reporting that all
candidates are claimed.

The cited canonical claim remains preserved as evidence in the run artifact, but
the replay with the fixed code shows `task-replace-readline-navigator-with-a-real-daemon-back`
is claimed with `recoveryPath: "replaced-stale-claim"` and no skipped
candidates.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-06T18-04-40-124Z-progress-reviewer-j2c2j6.

review verdict: needs-steering
review summary:

    Scope 8nrg1m/kota included 20 runs, 15 tasks, 28 events, 40 artifacts, and 60 git refs. Balance is Safety 4, Product 3, Platform 1, Meta 7. Security work is tracked and prior webhook diagnostics are resolved, but a stale builder claim is blocking the P1 daemon-backed TUI task, so one recovery follow-up is needed.

Evidence ids:

- task:task-replace-readline-navigator-with-a-real-daemon-back
- run:2026-07-06T17-22-34-577Z-builder-zos2wu
- artifact:2026-07-06T17-22-34-577Z-builder-zos2wu:task-claim.json
- run:2026-07-06T17-54-22-700Z-builder-m131hk

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-07-06T18-08-37-896Z-builder-hxa162/claim-recovery-evidence.json`
  records the canonical active claim for `task-replace-readline-navigator-with-a-real-daemon-back`,
  the interrupted owner run status and error text, and a replay where the fixed
  code claims the TUI task with `recoveryPath: "replaced-stale-claim"`.
- `pnpm test src/modules/autonomy/task-claim-recovery.test.ts src/modules/autonomy/task-claim-races.test.ts`
  passed.
- `.kota/runs/2026-07-06T18-08-37-896Z-builder-hxa162/validation.txt`
  records passing focused tests, typecheck, lint, and temporary-index
  `pnpm validate-tasks`.
- `.kota/runs/2026-07-06T18-08-37-896Z-builder-hxa162/task-move-cli-failure.txt`
  records why the normal task CLI move could not write the shared git index in
  this sandbox before the equivalent data-file move was applied manually.
