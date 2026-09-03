---
status: done
---
# Security review: The unauthenticated health endpoint can disclose raw provider or runtime error messages. Fleet chat failures are copied verbatim into the shared backoff reason, the resulting agent operating state is added to daemon health, and the complete health object is returned by a route that bypasses authentication.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-control-core-routes.ts
claim:

> The unauthenticated health endpoint can disclose raw provider or runtime error messages. Fleet chat failures are copied verbatim into the shared backoff reason, the resulting agent operating state is added to daemon health, and the complete health object is returned by a route that bypasses authentication.

## Desired Outcome

> Keep the public health response limited to stable state and reason codes. Redact or omit agentOperatingState.reason at the unauthenticated boundary, and sanitize provider error text before storing it in shared backoff state; expose any necessary diagnostic detail only through an authenticated operator surface.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-03T03-42-23-473Z-security-review-qkmszu.

Confirmed by security-review workflow runs:

- 2026-09-03T03-42-23-473Z-security-review-qkmszu

finding id: KOTA-SEC-HEALTH-BACKOFF-REASON
candidate id: daemon-control-route:src/core/daemon/daemon-control-core-routes.ts:1
verdict: confirmed
rationale:

> The fleet chat handler embeds the caught error message verbatim in the incident reason. AgentBackoffManager persists that reason, resolveAgentOperatingState copies it into agentOperatingState, buildDaemonHealthStatus includes that object unchanged, and GET /health returns it while bypassing bearer authentication. The control server is loopback-bound, which limits exposure to local callers, but does not remove the unauthenticated disclosure boundary.

Evidence:

Evidence 1:



path: src/core/daemon/daemon-chat-handlers.ts

line: 213

excerpt:



> const signal = { kind: classification.kind, reason: `Fleet one-shot agent review failed: ${reportedError instanceof Error ? reportedError.message : String(reportedError)}` }; const backoff = agentAttemptBoundary!.applyIncident(signal, session.scopeId);

Evidence 2:



path: src/core/daemon/daemon-handle.ts

line: 108

excerpt:



> getHealthStatus: () => buildDaemonHealthStatus(ctx.getModuleHealthChecks(), ctx.getEventLoopLatency?.(), lookupRuntime().workflowRuntime.getState().agentOperatingState)

Evidence 3:



path: src/core/daemon/daemon-control-core-routes.ts

line: 129

excerpt:



> method: "GET", path: "/health", capabilityScope: "read", bypassAuth: true

Evidence 4:



path: src/core/daemon/daemon-control-core-routes.ts

line: 135

excerpt:



> const health = h.getHealthStatus(); ... jsonResponse(res, degraded ? 503 : 200, { status: degraded ? "degraded" : "ok", version: "0.1.0", uptimeMs, components: health });

## Verification

- The unauthenticated health projection preserves stable component and agent
  state while omitting free-form agent reasons and module health messages.
- The shared backoff owner persists stable provider-incident reason codes
  instead of caught provider or runtime error text.
- `pnpm check:fast` passed, the focused `AgentBackoffManager` owner suite passed
  all 19 tests, and a source-mode runtime probe confirmed diagnostic text is
  absent from the public projection. The socket-backed daemon control suite
  could not bind loopback in the builder sandbox (`listen EPERM`); its focused
  route assertions remain updated for the normal owner-test environment.
