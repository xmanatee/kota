---
id: task-repair-workflow-failure-pattern-3f5735a73fb9
title: Repair persistent builder workflow failure pattern
status: done
priority: p1
area: autonomy
summary: Fix the local cause behind builder's persistent consecutive failure signal (step build error 94bd218e1875).
created_at: 2026-08-03T10:25:31.073Z
updated_at: 2026-08-03T18:44:50.476Z
task_class: Meta
---

## Problem

The `builder` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:builder:step-error:919bc68a7c8d`
Root-cause fingerprint: `workflow-failure-root:builder:6dca5b5d40ff`
Evidence fingerprint: `1725d89fee0e02084a79e91ee96154734479767728a877ff3ab5ac089329f1a1`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: builder
- Failure class: step-error:build:94bd218e1875
- Signal: step build error 94bd218e1875
- Run ids: 2026-08-03T09-28-03-535Z-builder-b67ca0, 2026-08-03T09-59-48-823Z-builder-3nnf9l, 2026-08-03T09-59-48-824Z-builder-k5abu2, 2026-08-03T10-26-13-761Z-builder-1fusa7, 2026-08-03T10-26-13-762Z-builder-inpqu3, 2026-08-03T11-14-38-737Z-builder-49mwvu, 2026-08-03T11-27-25-515Z-builder-gqpenr, 2026-08-03T11-27-25-516Z-builder-s4o6v0, 2026-08-03T12-08-31-093Z-builder-369i7m, 2026-08-03T13-20-05-894Z-builder-ceqy9p, 2026-08-03T14-32-25-880Z-builder-jc9agr, 2026-08-03T14-32-25-880Z-builder-1yp7jy, 2026-08-03T14-59-50-722Z-builder-xmr4em, 2026-08-03T14-59-50-722Z-builder-4zcjba
- Window: 2026-08-03T09:47:24.356Z to 2026-08-03T15:52:14.086Z
- Actionable reason: builder has 14 consecutive failed completed runs with the same owned failure class (step build error 94bd218e1875).

- run 2026-08-03T14-59-50-722Z-builder-4zcjba failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T14-59-50-722Z-builder-xmr4em failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T14-32-25-880Z-builder-1yp7jy failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T14-32-25-880Z-builder-jc9agr failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T13-20-05-894Z-builder-ceqy9p failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T12-08-31-093Z-builder-369i7m failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T11-27-25-516Z-builder-s4o6v0 failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T11-27-25-515Z-builder-gqpenr failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T11-14-38-737Z-builder-49mwvu failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T10-26-13-762Z-builder-inpqu3 failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T10-26-13-761Z-builder-1fusa7 failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T09-59-48-824Z-builder-k5abu2 failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T09-59-48-823Z-builder-3nnf9l failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable
- run 2026-08-03T09-28-03-535Z-builder-b67ca0 failed at step build: Repair loop for step "build" made no progress after <n> consecutive attempts. Still failing: success-criteria-declared, commit-stageable

## Desired Outcome

Repair the local workflow/runtime cause so the same pattern no longer
fires on fresh run artifacts. The fix may live in workflow code, repair
checks, validation, queue shaping, prompts, or local runtime handling, but
it should not hide the signal by broadening infrastructure exclusions
without evidence that the failure is actually outside KOTA's control.

## Constraints

- Use existing `.kota/runs/` metadata and run artifacts as evidence.
- Keep cost and throughput data out of autonomy-agent context.
- Do not create one task per run; keep this task anchored to the stable
  root-cause fingerprint above.
- Preserve provider/auth/rate-limit/timeout exclusions unless the local
  runtime handling is the defect being repaired.

## Product / Safety Link

Persistent monitored workflow failures are a runtime posture blocker:
autonomy cannot reliably ship or review Product/Safety work while this
root cause keeps recurring. This Meta repair is actionable only because
the detector crossed the local-code threshold on concrete run artifacts.

## Done When

- Fresh run artifacts no longer trigger this pattern fingerprint, or the
  threshold/classification is deliberately adjusted with a committed reason.
- Focused tests cover the local cause and the detector behavior that would
  have caught this recurrence.
- Operator-facing attention output still reports future escalations with
  the generated task id and without cost fields.

## Source / Intent

Auto-created by `workflow-failure-escalator` from recent workflow run
metadata. Persistent non-infrastructure workflow failures should become
one evidence-backed repair task instead of remaining only in digests or
improver context.

## Initiative

Autonomy fleet health: recurring local workflow failures should graduate
into deterministic, reviewable repair work.

## Acceptance Evidence

- Test output for the repaired workflow or runtime path.
- Detector test or run artifact showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Attention-event fixture or transcript showing any future escalation names
  the task id without cost fields.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:step-error:919bc68a7c8d -->
<!-- workflow-failure-evidence-fingerprint: 1725d89fee0e02084a79e91ee96154734479767728a877ff3ab5ac089329f1a1 -->
