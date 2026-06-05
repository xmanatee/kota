---
id: task-repair-workflow-failure-pattern-f5fc63f85021
title: Repair persistent improver workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind improver's persistent consecutive failure signal (step improve error 1eda855dc25d).
created_at: 2026-06-05T18:27:27.364Z
updated_at: 2026-06-05T18:27:27.364Z
---

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:7a7e7390ef6a`
Evidence fingerprint: `6e6a744100eb97efcdb004f4a0db0d700e72b7dc287919da94e1d922ef4d64e7`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:1eda855dc25d
- Signal: step improve error 1eda855dc25d
- Run ids: 2026-06-05T17-11-38-651Z-improver-3adcye, 2026-06-05T17-11-42-837Z-improver-e2qq0c, 2026-06-05T17-11-50-706Z-improver-vgy5z9
- Window: 2026-06-05T17:11:40.478Z to 2026-06-05T17:11:55.693Z
- Actionable reason: improver has 3 consecutive failed completed runs with the same owned failure class (step improve error 1eda855dc25d).

- run 2026-06-05T17-11-50-706Z-improver-vgy5z9 failed at step improve: spawn codex ENOENT
- run 2026-06-05T17-11-42-837Z-improver-e2qq0c failed at step improve: spawn codex ENOENT
- run 2026-06-05T17-11-38-651Z-improver-3adcye failed at step improve: spawn codex ENOENT

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
  pattern fingerprint above.
- Preserve provider/auth/rate-limit/timeout exclusions unless the local
  runtime handling is the defect being repaired.

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:7a7e7390ef6a -->
<!-- workflow-failure-evidence-fingerprint: 6e6a744100eb97efcdb004f4a0db0d700e72b7dc287919da94e1d922ef4d64e7 -->
