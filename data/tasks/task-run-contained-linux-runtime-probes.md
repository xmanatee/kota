---
status: open
priority: p1
depends_on: [task-enable-runtime-mediated-contained-evaluation]
---
# Run existing deterministic runtime probes on the available Linux container backend

## Problem

Native workers on this Mac cannot launch nested OS sandboxes or access Docker.
The host can: the September 12 monitor executed the existing database/absent-state
confinement checks successfully in a disposable Linux container. Browser credential
persistence remains unfinished because workers cannot exercise its real boundary.
This is missing internal execution mediation, not missing owner permission.

## Outcome

Make the existing deterministic task-probe/verification path usable through the
shared native tool mediation delivered by the predecessor. Inspect the current
task-probe runner, contained-workspace resolver, eval container launcher and module
tools first. Extend their existing owners; do not build another command service,
scheduler, protocol, per-task permission flag or evidence-request workflow.

The host selects an isolated current-source Linux environment. A task can execute
its scoped synthetic checks and receive their results without host mounts, raw
credentials, Docker socket access, production daemon control or arbitrary host
commands. Existing supervision, cancellation, attribution and cleanup must apply.
Image/setup discovery should identify actionable configuration, not ask for captures.

## Acceptance

- A native workflow invokes a deterministic synthetic verification through the
  maintained tool/probe boundary; actual Linux confinement and result return run.
- Browser persistence can use it for positive and relocation-adversarial checks.
  That consumer still owns implementing and verifying its writer.
- Scope widening and host-command escape remain denied. Cancellation cleans up.
  Reuse owning tests; do not repeat every module or create a parallel test suite.
- Publish implementation using proportionate local proof. The host monitor verifies
  activation and configures the existing host-owned backend; do not require a
  builder to restart its own parent or produce future deployment evidence.

