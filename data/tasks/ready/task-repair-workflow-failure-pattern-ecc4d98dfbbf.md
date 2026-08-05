---
id: task-repair-workflow-failure-pattern-ecc4d98dfbbf
title: Repair persistent progress-reviewer workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind progress-reviewer's persistent consecutive failure signal (step review-evidence error a46a4e99c75a).
created_at: 2026-08-05T09:31:40.519Z
updated_at: 2026-08-05T09:31:40.519Z
task_class: Meta
---

## Problem

The `progress-reviewer` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:progress-reviewer:step-error:5a927b61f240`
Root-cause fingerprint: `workflow-failure-root:progress-reviewer:66404e9d7cec`
Evidence fingerprint: `76a9228a07a3b8ebebcb0705039beff78da1dc218fdebe19b9ceb20100ec577a`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: progress-reviewer
- Failure class: step-error:review-evidence:a46a4e99c75a
- Signal: step review-evidence error a46a4e99c75a
- Run ids: 2026-08-05T07-44-52-888Z-progress-reviewer-c3ivzx, 2026-08-05T09-28-06-719Z-progress-reviewer-b6t5wx, 2026-08-05T09-30-07-321Z-progress-reviewer-f6pxjb
- Window: 2026-08-05T09:28:52.486Z to 2026-08-05T09:31:06.124Z
- Actionable reason: progress-reviewer has 3 consecutive failed completed runs with the same owned failure class (step review-evidence error a46a4e99c75a).

- run 2026-08-05T09-30-07-321Z-progress-reviewer-f6pxjb failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-28-06-719Z-progress-reviewer-b6t5wx failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T07-44-52-888Z-progress-reviewer-c3ivzx failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:progress-reviewer:step-error:5a927b61f240 -->
<!-- workflow-failure-evidence-fingerprint: 76a9228a07a3b8ebebcb0705039beff78da1dc218fdebe19b9ceb20100ec577a -->
