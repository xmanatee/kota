---
status: open
priority: p1
---
# Complete partial matrix preflight at public entry points

## Problem

Commit `60e1d25a7` repairs contained-matrix preparation, but does not complete
the shared partial-cohort contract. In `model-matrix-isolation.ts`,
`matrixEvalExecutor` lets `ContainerAuthUnavailableError` escape. The catch in
`model-matrix.ts` turns it into whole-matrix `invalid_eval_isolation`, preventing
independently available candidates from running through public matrix calls.
The subsequent preflight loop is outside that catch: strict login-file errors
from `containerAuthIssue` can reject the public operation instead of returning
an attributable typed failure. Keep strict rejection; repair its propagation.

Run `2026-09-12T23-34-29-865Z-builder-8dcny0` also retains four failed routing
checks in `retained-runtime/agent/routing-retest.log`: three missing launch logs
and one error-row result. They use a synthetic subprocess container backend,
not live Docker or model credentials. Existing assertions discard the earlier
executor/preflight error; their cause is unresolved, not proven environmental.

## Outcome

Finish this behavior through the existing eval-harness auth/preflight and
harness-parity preparation/report owners. Reuse the typed unavailable outcome
and existing execution rows across public and contained entry points; do not
add another matrix runner, adapter-specific skip rules or an error protocol.
Diagnose the retained routing failures at the shared launcher or fixture owner
before changing expectations. Show the actual failure, not a secondary ENOENT.

## Acceptance

- An explicitly unavailable native route remains an attributable unexecuted
  row while an independently authorized local candidate executes through the
  public matrix operation, including eval fixtures. No silent baseline removal.
- Malformed grants, invalid credentials, isolation failures and unexpected
  errors remain failures before inference, with useful public error reporting
  and diagnostic evidence. Never reinterpret them as unavailable or success.
- The four existing subprocess cases either pass after a demonstrated owning
  correction or expose a precise host restriction with an independently
  reproducible owner check. Do not weaken launch, routing, cleanup or isolation
  assertions just to obtain green output. Extend existing behavior cases only
  where the public boundary is currently uncovered; no mirrored suites.

This implementation is independently dispatchable. It does not require live
model quota, a contained host grant, or permission to bypass a Docker denial.
Live comparison and support-tier claims remain owned by
`task-run-live-openrouter-and-local-model-rollout-evalua`; link evidence rather
than copying run packets into source control.
