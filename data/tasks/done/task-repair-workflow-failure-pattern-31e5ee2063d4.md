---
id: task-repair-workflow-failure-pattern-31e5ee2063d4
title: Repair persistent improver workflow failure pattern
status: done
priority: p1
area: autonomy
summary: Fix the local cause behind improver's persistent consecutive failure signal (step improve error 4dfa530b8956).
created_at: 2026-08-03T16:47:35.896Z
updated_at: 2026-08-03T16:49:58.655Z
task_class: Meta
---

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:83cd54201d5f`
Root-cause fingerprint: `workflow-failure-root:improver:a912a7f5d9ce`
Evidence fingerprint: `58cc05340e6b16447bf221ec4b8e06682e836e991006aeabcd07c49b7ad6ed01`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:4dfa530b8956
- Signal: step improve error 4dfa530b8956
- Run ids: 2026-08-03T14-22-00-183Z-improver-hwyun7, 2026-08-03T15-31-51-772Z-improver-lwt9fc, 2026-08-03T16-18-10-001Z-improver-shk5s5
- Window: 2026-08-03T15:29:31.019Z to 2026-08-03T16:39:12.592Z
- Actionable reason: improver has 3 consecutive failed completed runs with the same owned failure class (step improve error 4dfa530b8956).

- run 2026-08-03T16-18-10-001Z-improver-shk5s5 failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: lint, test
- run 2026-08-03T15-31-51-772Z-improver-lwt9fc failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: lint, test
- run 2026-08-03T14-22-00-183Z-improver-hwyun7 failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: lint, test

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

- `1a16841de` removes the lint errors shared by all three failed runs.
- `f21905a5b` restores the strict validation checks that failed their test gate.
- `4a1de2bc2` preserves terminal repair output for future forensic review.
- Typecheck, lint, and 125 focused workflow, recovery, validation, DLQ,
  event-journal, and repair-loop checks passed after integration.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:83cd54201d5f -->
<!-- workflow-failure-evidence-fingerprint: 58cc05340e6b16447bf221ec4b8e06682e836e991006aeabcd07c49b7ad6ed01 -->
