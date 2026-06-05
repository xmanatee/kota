---
id: task-repair-workflow-failure-pattern-faf869e90a2c
title: Repair persistent progress-reviewer workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind progress-reviewer's persistent consecutive failure signal (step review-evidence error 1eda855dc25d).
created_at: 2026-06-05T20:05:28.959Z
updated_at: 2026-06-05T20:05:28.959Z
---

## Problem

The `progress-reviewer` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:progress-reviewer:step-error:8a9766f025b7`
Evidence fingerprint: `2c4dc7fbc4e1b7676f5ad09186b9d1dc7689e42cc0f8193fc7d50a953bc8f616`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: progress-reviewer
- Failure class: step-error:review-evidence:1eda855dc25d
- Signal: step review-evidence error 1eda855dc25d
- Run ids: 2026-06-05T17-11-45-171Z-progress-reviewer-npxicn, 2026-06-05T17-11-47-685Z-progress-reviewer-5ylwoc, 2026-06-05T17-13-13-994Z-progress-reviewer-dw3hr6
- Window: 2026-06-05T17:11:54.553Z to 2026-06-05T17:13:16.031Z
- Actionable reason: progress-reviewer has 3 consecutive failed completed runs with the same owned failure class (step review-evidence error 1eda855dc25d).

- run 2026-06-05T17-13-13-994Z-progress-reviewer-dw3hr6 failed at step review-evidence: spawn codex ENOENT
- run 2026-06-05T17-11-47-685Z-progress-reviewer-5ylwoc failed at step review-evidence: spawn codex ENOENT
- run 2026-06-05T17-11-45-171Z-progress-reviewer-npxicn failed at step review-evidence: spawn codex ENOENT

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:progress-reviewer:step-error:8a9766f025b7 -->
<!-- workflow-failure-evidence-fingerprint: 2c4dc7fbc4e1b7676f5ad09186b9d1dc7689e42cc0f8193fc7d50a953bc8f616 -->
