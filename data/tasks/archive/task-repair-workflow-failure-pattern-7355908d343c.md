---
status: done
---

# Repair persistent builder workflow failure pattern

## Problem

The `builder` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:builder:repair-check:ed9f63452889`
Root-cause fingerprint: `workflow-failure-root:builder:e8bef0b73dbf`
Evidence fingerprint: `54f87f3494490b46ba2dd535dba62c79edc08a9739d1cc7645296f98d2e889d4`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: builder
- Failure class: repair-check:source-file-size-severe
- Signal: repair-check source-file-size-severe
- Run ids: 2026-08-13T10-23-52-462Z-builder-bojhem, 2026-08-13T10-59-08-563Z-builder-tq9ibo, 2026-08-13T11-49-21-496Z-builder-1clmsy
- Window: 2026-08-13T11:49:11.907Z to 2026-08-13T12:58:26.233Z
- Actionable reason: builder has 3 consecutive failed completed runs with the same owned failure class (repair-check source-file-size-severe).

- run 2026-08-13T11-49-21-496Z-builder-1clmsy ended with repair-check source-file-size-severe
- run 2026-08-13T10-59-08-563Z-builder-tq9ibo ended with repair-check source-file-size-severe
- run 2026-08-13T10-23-52-462Z-builder-bojhem ended with repair-check source-file-size-severe

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

- Commit `132438782a063cabc88a8f04445f0c574035cf85` identifies all three
  cited builder runs and fixes their shared terminal cause: the repair loop
  no longer passes `resumeSessionId` to a harness that declares that option
  unsupported. The source-size findings remain honest and actionable; the fix
  restores the repair agent that was supposed to address them.
- Fresh builder run `2026-08-13T13-41-33-035Z-builder-agejs2` exercised the
  post-fix Codex repair path. Its committed
  `repair-delivery-and-dlq-reconciliation.md` artifact records that repair
  attempt 1 reached a fresh Codex invocation, corrected the seeded evidence
  failure, and moved its task to done without the former SDK/provider
  rejection.
- Focused validation on 2026-08-13 passed 4 files and 77 tests:
  `repair-loop-usage.test.ts`, `workflow-step-executor.integration.test.ts`,
  `workflow-failure-escalation.test.ts`, and the workflow-failure-escalator
  `workflow.test.ts`. The coverage proves unsupported-resume routing, proves a
  successful fresh run clears an old consecutive-failure streak, and requires
  future attention events to include the generated repair task id while
  excluding cost and throughput fields.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:repair-check:ed9f63452889 -->
<!-- workflow-failure-evidence-fingerprint: 54f87f3494490b46ba2dd535dba62c79edc08a9739d1cc7645296f98d2e889d4 -->
