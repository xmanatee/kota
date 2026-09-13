---
status: done
---
# Contain run-local failures without parking unrelated agent work

## Outcome

A workflow's invalid local input, missing review export or publication contract
must remain a visible failure owned by that run, without being reported as a
provider outage or parking unrelated work. Genuine shared provider, authentication
and harness readiness failures must still apply the existing shared backoff.

## Evidence

Blocked review `2026-09-13T09-09-35-908Z-blocked-promoter-0b43ma` rejected a
40,091,312-byte local evidence packet before inference. `step-context.ts` threw
the required-evidence error; `autonomy/agent-judge.ts` converted the unclassified
exception into `AgentStepRuntimeError(..., "runtime", false)`. Shared backoff
then deferred every agent workflow for 30, 60 and 30 minutes. About 107 minutes
had elapsed under these holds by 11:11 UTC, including independent builder work.
This was not quota exhaustion or an unavailable Codex service.

Commit `a4cfc0977` fixes the collector's accidental selection of prose as run
identities. It does not correct this broader failure-attribution boundary.
See the original run, `dlq-d766a594-05c9-4bb5-b5a9-d1d1ff0981d6`, and runtime
issue `autonomy-issue-41a3aeee41682ff99f60`; do not create another collector task.

## Approach

Trace ordinary steps, nested critics and structured judges through the shared
execution-error and backoff owners. Preserve the error's origin across these
boundaries using existing failure contracts; do not classify every unknown
exception as a shared runtime incident. Keep genuine process/bootstrap failures
distinct from local evidence or validation rejection. Use normal run retry,
needs-attention and issue investigation for local failures, not another queue,
circuit breaker, classifier per workflow or error-message allowlist.

## Acceptance

- Reproduce the recorded required-evidence failure before the harness call. The
  affected run remains visibly failed/recoverable with its evidence and ownership
  preserved; another eligible run can start and continue in the other slot.
- Provider quota/authentication/unavailability and genuine shared harness
  readiness failures retain their existing fleet protection and reset semantics.
- Nested and top-level callers report consistent failure provenance; repeated
  local failures reach the existing issue owner without an unchanged retry storm.
- Extend the existing owning behavior tests with this consequential distinction,
  remove any replaced classification path, and use proportionate verification.
  Runtime activation and subsequent live observation follow publication; they
  are not prerequisites for a builder to finish this implementation.

## Resolution

Local invocation failures now preserve their provenance through evidence handoff,
critic and structured judges, and continuation review. They fail the owning run
without shared backoff or treating unavailable review as permission for source
repair. Classified failures preserve their kind and provider retry horizon,
including exhausted transient retries. Existing runtime readiness and quality
incident protections remain in place.

The composed runtime regression reproduces a 40,091,312-byte required packet
rejection before inference through direct, critic and structured callers. It
observes retained writer content, task-resource ownership, an execution-class
dead letter with no backoff, no automatic retry of unchanged failed work, and an
independent agent continuing and starting again with concurrency two. Only the
inference and socket-availability ports are controlled.

Validation: production build and deterministic static checks passed. The broader
owning/runtime selection passed 232 of 235 tests, including all three composed
reproductions, classification, shared backoff/reset, continuation, lifecycle,
coordinator, dead-letter and issue-source tests. Three existing process checks
could not execute under sandbox process restrictions; an earlier context suite
also hit `/bin/ps EPERM` in process registration. No live provider or deployment
observation is claimed; activation follows runtime-owned publication.
