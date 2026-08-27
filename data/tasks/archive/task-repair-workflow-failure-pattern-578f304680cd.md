---
status: done
---

# Repair persistent builder workflow failure pattern

## Problem

The `builder` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:builder:repair-check:9f86d081884c`
Root-cause fingerprint: `workflow-failure-root:builder:adb74b9d8e67`
Evidence fingerprint: `88df3ffe9feda1a94c1fd8e21583b2e84d07448170d5a2f33769c786228e72bf`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: builder
- Failure class: repair-check:test
- Signal: repair-check test
- Run ids: 2026-08-13T10-23-52-462Z-builder-bojhem, 2026-08-13T10-59-08-563Z-builder-tq9ibo, 2026-08-13T11-49-21-496Z-builder-1clmsy
- Window: 2026-08-13T11:49:11.907Z to 2026-08-13T12:58:26.233Z
- Actionable reason: builder has 3 consecutive failed completed runs with the same owned failure class (repair-check test).

- run 2026-08-13T11-49-21-496Z-builder-1clmsy ended with repair-check test
- run 2026-08-13T10-59-08-563Z-builder-tq9ibo ended with repair-check test
- run 2026-08-13T10-23-52-462Z-builder-bojhem ended with repair-check test

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:repair-check:9f86d081884c -->
<!-- workflow-failure-evidence-fingerprint: 88df3ffe9feda1a94c1fd8e21583b2e84d07448170d5a2f33769c786228e72bf -->
