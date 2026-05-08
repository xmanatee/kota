---
id: task-add-daemon-project-registry-and-projectid-attribut
title: Add daemon project registry primitive and DaemonConfig multi-project plumbing
status: done
priority: p2
area: architecture
summary: Introduce a typed ProjectRegistry primitive and DaemonConfig multi-project plumbing so subsequent slices can convert per-project runtime bundles, projectId payloads, and control-API scope on top of one foundation.
created_at: 2026-05-07T23:59:14.156Z
updated_at: 2026-05-08T01:00:22.269Z
---

## Problem

The daemon is single-project today: `DaemonConfig.projectDir` is consumed
once at construction and every daemon-owned subsystem — workflow runtime,
run store, task store, scheduler, module-log store, notification gate,
owner-question queue, approval queue, event bus, push-token store, and
every control-API handler — binds to that one root. `ClientIdentity`
exposes `projectName` + `projectDir` as singular fields, and the embedded
HTTP routes return flat lists with no project scope. Operators cannot
supervise more than one project from the same daemon, and there is no
durable identity primitive a client can use to ask for project-scoped
state.

The Variant A decision (2026-05-07, parent task
`task-surface-project-selection-in-operator-clients-for-`) commits the
daemon to becoming the multi-project host. The original "daemon
foundation" decomposition bundled the registry primitive, the
per-project runtime bundle for nine subsystems, projectId payloads on
every event, projectId scope on every control-API route, two-language
decoder updates, a typed singleton-binding invariant test, and a
two-project daemon integration test into one task — too large for one
builder run with honest end-to-end fulfillment. This task is the
foundation slice; the four follow-up tasks below carry the rest.

## Desired Outcome (this slice)

- A typed `ProjectRegistry` primitive in `src/core/daemon/` with stable
  derived `projectId`, deterministic-from-`projectDir` identity, and
  file-backed persistence under the daemon state directory.
- `DaemonConfig` accepts more than one configured project. `projectDir`
  is preserved as the single-project shorthand and seeds a single-entry
  registry.
- The daemon constructor builds the registry once and exposes it on the
  runtime context (`DaemonRuntimeContext.projectRegistry`) so later
  slices can wire the per-project bundle and the control-API projection
  against the same primitive.
- Documentation for the multi-project shape moved from "open question"
  to "implemented foundation, follow-ups sequenced".

## Constraints

- One daemon-owned registry. Project metadata is not pushed into client
  files or a multi-daemon façade.
- Strict typed scope. The primitive's `ProjectId` is derived
  deterministically from the resolved `projectDir`; no nullable
  fall-through to a global root. Empty inputs throw, duplicate inputs
  throw.
- KOTA-on-itself with one configured project produces the same
  observable output it does today (status, identity, sessions list).
- This slice does not change any control-API surface, event payload, or
  store binding. Those changes ship in the follow-up tasks below in
  lockstep with their conformance updates.

## Done When (this slice)

- A `ProjectRegistry` primitive exists in the daemon core with typed
  `projectId`, `projectDir`, and `displayName`, persisted under the
  daemon state directory.
- `DaemonConfig` accepts more than one configured project; `projectDir`
  remains the default-project shorthand for single-project operators.
- The daemon constructor builds one registry from configured input and
  exposes it on `DaemonRuntimeContext`.
- Focused tests cover deterministic `projectId` derivation,
  `ConfiguredProject` resolution, registry construction, lookup,
  default-project selection, persistence, and `ConfiguredProjectInput`
  resolution from `DaemonConfig`.
- All existing daemon tests continue to pass.

## Deferred Done-When (tracked in follow-up tasks)

The remaining items from the originally bundled "Done When" list are
each sized for one builder run and live in their own backlog tasks:

- **Per-project runtime bundle for nine subsystems + typed singleton
  invariant test** —
  `task-add-per-project-projectruntime-bundle-factory-and-`.
- **`projectId` on every event-bus payload** —
  `task-add-projectid-to-every-event-bus-payload`.
- **`projectId` on every control-API route + `ClientIdentity` registry
  projection + contract-fixture + TS + Swift decoders updated in
  lockstep** —
  `task-thread-projectid-through-control-api-routes-and-up`.
- **Two-project daemon integration test asserting events/runs/approvals
  never cross `projectId`** —
  `task-add-multi-project-daemon-isolation-integration-tes`.

These follow-ups are sequenced after this foundation and unblock the
existing CLI/web/native client selector tasks already in `blocked/`.

## Source / Intent

Decomposition of `task-surface-project-selection-in-operator-clients-for-`
(Variant A, resolved 2026-05-07). The parent task records the owner ask
("KOTA must operate beyond the KOTA repo and supervise external
projects") and the architectural standard that clients use one daemon
control protocol rather than per-platform side channels. The previous
decompose task split surface (daemon vs CLI vs web vs native); this run
splits the daemon-foundation slice horizontally into four builder-run-
sized sub-slices because the bundled foundation could not honestly land
in one run.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the
same daemon control contract.

## Acceptance Evidence

- `pnpm vitest run src/core/daemon/project-registry.test.ts` — focused
  unit suite for the new primitive (deterministic id derivation,
  configured-project resolution, registry lookup/default/persistence,
  `ConfiguredProjectInput` resolution paths).
- `pnpm vitest run src/core/daemon/` — full daemon test suite green
  after the foundation lands so no existing daemon behavior regresses.
- `src/core/daemon/AGENTS.md` updated to describe the foundation +
  sequenced follow-ups.
