---
id: task-add-an-executable-container-isolation-backend-for-
title: Add an executable container isolation backend for eval-harness runs
status: ready
priority: p2
area: modules
summary: Run eval-harness subprocess fixtures inside an explicit container backend that enforces requested CPU and memory profile facts, preserves fixture isolation, and records typed diagnostics when the backend cannot satisfy them.
created_at: 2026-05-26T18:33:30.516Z
updated_at: 2026-05-26T18:33:30.516Z
---

## Problem

`src/modules/eval-harness/subprocess-executor.ts` now has a typed
`SubprocessIsolationBackend` union and an `ExecutionProfilePreflightResult`
shape that can represent a `container` backend, but the container branch is
not executable. It probes the configured executable, then throws:

```ts
Container isolation backend "${backend.executable}" is available but eval-harness subprocess execution does not yet run fixtures inside it.
```

That leaves the eval harness with a strict profile contract but no verified
backend path that can make cadence runs gate-eligible. Host subprocess runs
are correctly non-gating because they only observe host CPU and memory facts.
The remaining implementation gap is to make the module-owned container backend
real enough that fixture execution can enforce or verify the resource profile
it records.

Fresh peer-runtime signal reinforces the gap. OpenHands 1.7.0 added
`SANDBOX_KVM_ENABLED` so sandbox containers can pass through `/dev/kvm` for
nested virtualization. The important KOTA takeaway is not to copy that exact
flag; it is that sandbox host capabilities belong in an explicit typed
backend contract. Docker's resource-constraint docs also document the CPU and
memory controls KOTA can map to its existing `ResourceProfile` fields.

## Desired Outcome

`kota eval run` and the cadence workflow can opt into a module-owned container
executor that actually runs eval fixtures inside the configured container
backend instead of throwing when the backend is available.

The container path preserves the current fixture isolation guarantees:
materialized fixture working directories stay outside the operator repo,
`HOME` and `KOTA_PROJECT_DIR` point at the fixture working directory, replay
recording env and external-call shims still work, and run artifacts are
written back to the expected eval-run artifact directory.

When the container backend can enforce or deterministically verify the
requested CPU and memory allocation and kill-threshold facts, the preflight
returns a verified gate-eligible execution profile. When the backend is
missing or cannot satisfy the requested facts, the result is a typed
non-gating or rejected preflight with diagnostics. It must never silently
downgrade to host subprocess execution while preserving a gate-eligible
profile.

## Constraints

- Keep the work in `src/modules/eval-harness/`. Do not add a generic core
  sandbox abstraction or a second eval runner.
- Use a typed backend config. The minimum useful shape should name the
  executable and image or template needed to run the fixture. Avoid free-form
  Docker option passthrough.
- Do not expose host devices, privileged mode, host networking, or broad
  volume mounts by default. Any future capability such as `/dev/kvm`
  passthrough must be a named opt-in that is recorded in execution-profile
  diagnostics.
- Preserve the existing missing-backend behavior as an explicit non-gating
  preflight result.
- Preserve host-subprocess behavior and diagnostics for the default path.
- Keep exact command construction, profile mapping, and artifact behavior in
  source types and focused tests, not durable docs.

## Done When

- `SubprocessIsolationBackend` has a strict container config and the container
  preflight no longer throws merely because the executable exists.
- The container executor runs the same `kota workflow exec <name>` fixture
  command through the configured backend with bounded CPU and memory settings
  derived from `ResourceProfile`.
- The executor records the observed or enforced profile, backend kind,
  verification mode, gate eligibility, and diagnostics in the existing
  execution-profile artifact shape.
- `kota eval run` exposes a deliberate way to select the container backend
  and its required typed fields, while the cadence path has an explicit
  module-owned selection point and keeps its current host-subprocess default
  unless configured.
- Missing container executable, image/config problems, resource-profile
  mismatch, and successful verified container preflight are all covered by
  focused tests.
- Tests prove fixture env remapping, replay env, external-call shims, timeout
  handling, and artifact copy-back still work for the container path.
- No generic Docker option passthrough, privileged default, host network
  default, or unrecorded device access is introduced.

## Source / Intent

Explorer run `2026-05-26T18-31-01-762Z-explorer-gbpjbu` reviewed a queue with
zero actionable ready/doing tasks. The strategic blocked alternatives were all
real operator-capture waits and none were movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://github.com/OpenHands/OpenHands/releases` - OpenHands 1.7.0 includes
  `SANDBOX_KVM_ENABLED` for passing `/dev/kvm` into sandbox containers.
- `https://github.com/OpenHands/OpenHands/pull/13618` - the underlying PR
  frames nested-virtualization support as an explicit sandbox capability.
- `https://docs.docker.com/engine/containers/resource_constraints/` - Docker
  documents CPU and memory resource controls that can enforce or bound a
  container's runtime profile.

Local overlap check:

- `task-bind-eval-harness-resource-profiles-to-executable` is done and added
  the strict execution-profile contract plus typed non-gating behavior, but
  intentionally left the available container backend unimplemented.
- No open ready, backlog, blocked, or inbox item covers executing eval-harness
  fixtures inside a container backend.
- The current code path in
  `src/modules/eval-harness/subprocess-executor.ts` still throws when a
  container executable is present.

## Initiative

Eval-harness reliability: autonomy regression gates should become
gate-eligible only when the executor can make its recorded isolation and
resource facts true.

## Acceptance Evidence

- Focused test transcript for the subprocess executor container path, for
  example `pnpm test src/modules/eval-harness/subprocess-executor.test.ts`.
- Focused eval CLI/client transcript proving the typed container selection
  surface, for example `pnpm test src/modules/eval-harness/cli.test.ts
  src/modules/eval-harness/eval-operations.test.ts` or the narrower updated
  test set.
- A run artifact under `.kota/runs/<run-id>/` showing a container preflight
  result with backend kind, requested profile, observed/enforced profile, gate
  eligibility, and diagnostics. A fake backend fixture is acceptable when live
  Docker is not available in the builder sandbox.
- `pnpm test src/task-files.test.ts` passes.
