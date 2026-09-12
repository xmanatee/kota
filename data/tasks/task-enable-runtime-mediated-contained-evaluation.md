---
status: open
priority: p1
---
# Make contained evaluation callable through the existing runtime action boundary

## Problem

AGY benchmark run `2026-09-12T06-40-57-819Z-builder-n2rhhp` and rollout builder
`2026-09-12T06-41-11-663Z-builder-drp743` can implement routing but cannot invoke
Docker, local inference endpoints or host-managed login from their native worker
sandbox. Host Docker access works. Repeatedly labeling this missing mediation as
an owner-capture prerequisite prevents both tasks from reaching live evaluation.

## Outcome

An authorized automation can request a bounded contained evaluation through the
existing eval module's tool/client/action boundary. The trusted runtime invokes
the existing runner and returns attributable results to the requesting run. The
coding worker and evaluated candidate remain isolated; neither receives general
host shell access, a Docker socket or raw host credentials.

Inspect existing eval client/API routes, native tool mediation and execution
authorization before changing code. Reuse their capability and lifecycle owners,
not a new queue, executor, approval system or provider-specific bridge. The recent
native-auth/local-routing work belongs to its existing owners and must not be
reimplemented here. Keep image and restricted egress setup discoverable through
the same evaluation surface; return actionable setup failures, not a vague capture request.

## Acceptance

- An authorized workflow call reaches the trusted eval runner across the native
  isolation boundary and returns results/artifacts under its originating run.
- Existing authorization constrains scope, scenario, image, network and resource
  access. Untrusted arguments cannot become arbitrary Docker commands or host mounts.
- Existing cancellation, process supervision, provider backoff and cleanup apply
  to the delegated execution. No detached, unowned or duplicate evaluation survives.
- Focused boundary checks distinguish authorized invocation, denied widening,
  cancellation and returned failure. Do not repeat every model/scenario combination.
- The implementation can publish without restarting its own parent or running
  the complete live benchmark from the coding sandbox. The host monitor verifies
  the deployed invocation; the dependent tasks own actual model measurements.

## Consumers

The AGY routing benchmark and OpenRouter/local rollout evaluation use this same
capability. They retain their model-quality and containment requirements; this
task does not mark either benchmark completed or permit changing production defaults.
