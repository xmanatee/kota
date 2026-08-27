---
status: done
---

# Repair persistent builder workflow failure pattern

## Problem

The `builder` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:builder:step-error:48eafa5c344b`
Root-cause fingerprint: `workflow-failure-root:builder:db3307cddcc3`
Evidence fingerprint: `bbfe96b074115b12b880453a2723291c48f8b61b5ed49bbbeb8740688c8a7d36`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: builder
- Failure class: step-error:build:bcf26d672efe
- Signal: step build error bcf26d672efe
- Run ids: 2026-07-25T09-29-16-817Z-builder-fwsgnd, 2026-07-25T09-29-16-817Z-builder-28f0dn, 2026-07-25T09-34-01-016Z-builder-jmrqga, 2026-07-25T09-34-01-017Z-builder-12cvtt
- Window: 2026-07-25T09:30:57.385Z to 2026-07-25T09:37:35.224Z
- Actionable reason: builder has 4 consecutive failed completed runs with the same owned failure class (step build error bcf26d672efe).

- run 2026-07-25T09-34-01-017Z-builder-12cvtt failed at step build: Agent step "build" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_servic...
- run 2026-07-25T09-34-01-016Z-builder-jmrqga failed at step build: Agent step "build" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_servic...
- run 2026-07-25T09-29-16-817Z-builder-28f0dn failed at step build: Agent step "build" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_servic...
- run 2026-07-25T09-29-16-817Z-builder-fwsgnd failed at step build: Agent step "build" failed (codex_cli_error): unexpected status <n> Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: <hash>-LHR, auth error: <n>, auth error code: biscuit_baker_servic...

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

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:step-error:48eafa5c344b -->
<!-- workflow-failure-evidence-fingerprint: bbfe96b074115b12b880453a2723291c48f8b61b5ed49bbbeb8740688c8a7d36 -->
