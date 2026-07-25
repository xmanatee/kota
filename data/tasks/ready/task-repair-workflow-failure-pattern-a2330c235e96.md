---
id: task-repair-workflow-failure-pattern-a2330c235e96
title: Repair persistent improver workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind improver's persistent consecutive failure signal (step improve error 6339604e1fd6).
created_at: 2026-07-25T09:32:01.124Z
updated_at: 2026-07-25T09:33:53.513Z
task_class: Meta
---

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:046dff6a1668`
Root-cause fingerprint: `workflow-failure-root:improver:079aebe7f475`
Evidence fingerprint: `11410eb6fece082771f63ebddf8c0208b63ccbe9bf1f8578e3865bba65b50c50`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:6339604e1fd6
- Signal: step improve error 6339604e1fd6
- Run ids: 2026-07-25T09-14-56-651Z-improver-prqywv, 2026-07-25T09-24-31-753Z-improver-tjgbxw, 2026-07-25T09-26-03-561Z-improver-io2la2, 2026-07-25T09-29-23-402Z-improver-wmk8bc, 2026-07-25T09-30-59-295Z-improver-bpr4fn
- Window: 2026-07-25T09:24:25.742Z to 2026-07-25T09:33:37.159Z
- Actionable reason: improver has 5 consecutive failed completed runs with the same owned failure class (step improve error 6339604e1fd6).

- run 2026-07-25T09-30-59-295Z-improver-bpr4fn failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-29-23-402Z-improver-wmk8bc failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-26-03-561Z-improver-io2la2 failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-24-31-753Z-improver-tjgbxw failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-14-56-651Z-improver-prqywv failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:046dff6a1668 -->
<!-- workflow-failure-evidence-fingerprint: 11410eb6fece082771f63ebddf8c0208b63ccbe9bf1f8578e3865bba65b50c50 -->
