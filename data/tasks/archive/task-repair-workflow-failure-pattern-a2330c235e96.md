---
status: done
---

# Repair persistent improver workflow failure pattern

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:046dff6a1668`
Root-cause fingerprint: `workflow-failure-root:improver:079aebe7f475`
Evidence fingerprint: `64c1ec3cb201ced2fc8995675f070020097b11846c66f42a25ab343c4049768f`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:6339604e1fd6
- Signal: step improve error 6339604e1fd6
- Run ids: 2026-07-25T09-14-56-651Z-improver-prqywv, 2026-07-25T09-24-31-753Z-improver-tjgbxw, 2026-07-25T09-26-03-561Z-improver-io2la2, 2026-07-25T09-29-23-402Z-improver-wmk8bc, 2026-07-25T09-30-59-295Z-improver-bpr4fn, 2026-07-25T09-34-08-252Z-improver-fpx9u6, 2026-07-25T09-35-50-155Z-improver-nyjinx, 2026-07-25T09-37-37-104Z-improver-53qru2, 2026-07-25T09-39-36-515Z-improver-ph4nok
- Window: 2026-07-25T09:24:25.742Z to 2026-07-25T09:41:27.802Z
- Actionable reason: improver has 9 consecutive failed completed runs with the same owned failure class (step improve error 6339604e1fd6).

- run 2026-07-25T09-39-36-515Z-improver-ph4nok failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-37-37-104Z-improver-53qru2 failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-35-50-155Z-improver-nyjinx failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
- run 2026-07-25T09-34-08-252Z-improver-fpx9u6 failed at step improve: Agent step "improve" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_serv...
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

## Result

Commit `0eb76a9f5` landed after this task was generated and added the exact
provenance-bound Codex CLI provider classification required by the cited
failures. Replaying all nine canonical improver metadata files now classifies
each circuit-open 503 as `provider` and returns no persistent failure patterns.
Focused runtime, aggregation, detector, and attention-workflow coverage passes
53 tests; the generated attention fixture names this task id and contains no
cost or throughput fields. Replay and output evidence is retained under
`.kota/runs/2026-07-25T11-13-01-617Z-builder-ygg81d/`; the implementation's
promote decision is retained under
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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:046dff6a1668 -->
<!-- workflow-failure-evidence-fingerprint: 64c1ec3cb201ced2fc8995675f070020097b11846c66f42a25ab343c4049768f -->
