---
id: task-repair-workflow-failure-pattern-b84d9d0f452d
title: Repair persistent progress-reviewer workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind progress-reviewer's persistent consecutive failure signal (step review-evidence error 75a9264428a7).
created_at: 2026-08-06T19:03:50.676Z
updated_at: 2026-08-06T19:03:50.676Z
task_class: Meta
---

## Problem

The `progress-reviewer` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:progress-reviewer:step-error:556ea0c99bcf`
Root-cause fingerprint: `workflow-failure-root:progress-reviewer:bd304e437e5d`
Evidence fingerprint: `bf0180f6c2ff613dde33b00de98a045c491450247332b3ef44b449de88f1a807`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: progress-reviewer
- Failure class: step-error:review-evidence:75a9264428a7
- Signal: step review-evidence error 75a9264428a7
- Run ids: 2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul, 2026-08-06T13-58-27-896Z-progress-reviewer-v0ge1r, 2026-08-06T14-25-33-083Z-progress-reviewer-w67c27, 2026-08-06T18-44-27-907Z-progress-reviewer-2hdefe
- Window: 2026-08-06T18:44:35.663Z to 2026-08-06T19:03:44.837Z
- Actionable reason: progress-reviewer has 4 consecutive failed completed runs with the same owned failure class (step review-evidence error 75a9264428a7).

- run 2026-08-06T18-44-27-907Z-progress-reviewer-2hdefe failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA's passive contract.
- run 2026-08-06T14-25-33-083Z-progress-reviewer-w67c27 failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA's passive contract.
- run 2026-08-06T13-58-27-896Z-progress-reviewer-v0ge1r failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA's passive contract.
- run 2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul failed at step review-evidence: Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA's passive contract.

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:progress-reviewer:step-error:556ea0c99bcf -->
<!-- workflow-failure-evidence-fingerprint: bf0180f6c2ff613dde33b00de98a045c491450247332b3ef44b449de88f1a807 -->
