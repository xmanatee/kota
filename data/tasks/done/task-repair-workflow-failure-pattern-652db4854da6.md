---
id: task-repair-workflow-failure-pattern-652db4854da6
title: Repair persistent progress-reviewer workflow failure pattern
status: done
priority: p1
area: autonomy
summary: Fix the local cause behind progress-reviewer's persistent consecutive failure signal (step review-evidence error 5e07f703d5ac).
created_at: 2026-07-25T09:38:36.541Z
updated_at: 2026-07-25T10:55:31.199Z
task_class: Meta
---

## Problem

The `progress-reviewer` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:progress-reviewer:step-error:22eb9aa80092`
Root-cause fingerprint: `workflow-failure-root:progress-reviewer:7a09eecb4733`
Evidence fingerprint: `a491c313373aed27adc2e15c8cb14ca29722c78ea42adbd5f0d2dca90e355b4b`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: progress-reviewer
- Failure class: step-error:review-evidence:5e07f703d5ac
- Signal: step review-evidence error 5e07f703d5ac
- Run ids: 2026-07-25T09-25-10-911Z-progress-reviewer-8q9xdq, 2026-07-25T09-29-23-366Z-progress-reviewer-54wn6v, 2026-07-25T09-35-50-065Z-progress-reviewer-o0f8t1
- Window: 2026-07-25T09:28:04.749Z to 2026-07-25T09:36:41.853Z
- Actionable reason: progress-reviewer has 3 consecutive failed completed runs with the same owned failure class (step review-evidence error 5e07f703d5ac).

- run 2026-07-25T09-35-50-065Z-progress-reviewer-o0f8t1 failed at step review-evidence: Agent step "review-evidence" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_ba...
- run 2026-07-25T09-29-23-366Z-progress-reviewer-54wn6v failed at step review-evidence: Agent step "review-evidence" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_ba...
- run 2026-07-25T09-25-10-911Z-progress-reviewer-8q9xdq failed at step review-evidence: Agent step "review-evidence" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_ba...

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

## Result

Commit `0eb76a9f5` landed after this task was generated and added the exact
provenance-bound Codex CLI provider classification this evidence required.
Replaying the three cited metadata files now classifies the circuit-open 503
as `provider` and returns no persistent failure patterns. Focused runtime,
aggregation, detector, and attention-workflow coverage passes 53 tests; the
attention fixture still requires generated task ids and rejects cost or
throughput fields. The decision and replay output are retained under
`.kota/runs/2026-07-25T10-03-33-551Z-builder-jyv1kl/`.

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:progress-reviewer:step-error:22eb9aa80092 -->
<!-- workflow-failure-evidence-fingerprint: a491c313373aed27adc2e15c8cb14ca29722c78ea42adbd5f0d2dca90e355b4b -->
