---
id: task-add-daemon-project-registry-and-projectid-attribut
title: Add daemon project registry and projectId attribution for multi-project runtime
status: ready
priority: p2
area: architecture
summary: Introduce a daemon project registry, per-project runtime bundle, and projectId scope on every store/event/control-API payload so one daemon process can host more than one project at once.
created_at: 2026-05-07T23:59:14.156Z
updated_at: 2026-05-07T23:59:14.156Z
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
daemon to becoming the multi-project host. Until the registry and the
`projectId` scope land in core, the CLI/web/native follow-up tasks cannot
build a project selector against an authoritative source of truth.

## Desired Outcome

The daemon process owns a typed project registry (configured roots,
durable `projectId`, display name) and constructs a per-project runtime
bundle for every registered project. Every session, run, scheduled item,
event, owner question, approval, and push notification carries a
`projectId`. The control-API surface exposes the registry, the active
project (if any single-project default is preserved for KOTA-on-itself),
and accepts a `projectId` parameter on list/subscribe/mutate routes that
return project-scoped state.

`ClientIdentity` is extended (or replaced by a sibling endpoint) to carry
the registry projection clients need to render a selector without
reading `.kota/` files or the daemon's config directly.

## Constraints

- One daemon-owned registry. Do not push project metadata into client-side
  files or expose a multi-daemon façade as the primary path.
- Strict typed scope. Every store, event payload, and API response that
  refers to project-scoped state names a `projectId`; no nullable
  fall-through to a global root.
- KOTA-on-itself stays a one-line operator experience. With one project
  configured, no operator-visible behavior regresses.
- A typed invariant test scans for singleton store binding (a store or
  scheduler constructed without a `projectId`) and fails if a new
  subsystem forgets to declare scope.
- The contract conformance gate (`contract-fixture.json` +
  TS/Swift decoder tests + cross-client integration) is updated in lockstep
  whenever a new control-API surface ships, per `clients/AGENTS.md`.
- No client work in this task. Selectors and per-project views land in
  sibling follow-ups (`task-add-cli-daemon-mode-project-selector-and-views`,
  `task-add-web-client-project-selector-and-views`).

## Done When

- A `ProjectRegistry` primitive exists in the daemon core with typed
  `projectId`, `projectDir`, and `displayName`, persisted under the daemon
  state directory.
- `DaemonConfig` accepts more than one configured project. `projectDir`
  becomes the default-project shorthand for single-project operators.
- Each project has its own runtime bundle (workflow runtime, run store,
  task store, scheduler, module-log store, notification gate, approval
  queue, owner-question queue, push-token store) constructed via a typed
  per-project factory.
- Every event the bus emits carries a `projectId` in its payload (or in
  an envelope wrapping it).
- Control-API routes that list or mutate project-scoped state accept a
  `projectId` parameter and return scoped data; routes that list across
  projects (e.g. registry listing) return a typed shape that names the
  scope.
- A typed invariant test rejects new singleton store bindings and runs as
  part of the daemon test suite.
- KOTA-on-itself with one configured project produces the same observable
  output it does today (status, identity, sessions list).
- Contract-fixture, TS decoder test, and Swift decoder test are updated
  for any new identity / registry / scope surface.

## Source / Intent

Decomposition of `task-surface-project-selection-in-operator-clients-for-`
(Variant A, resolved 2026-05-07). The parent task records the owner ask
("KOTA must operate beyond the KOTA repo and supervise external
projects") and the architectural standard that clients use one daemon
control protocol rather than per-platform side channels.

Variant A was chosen over Variant B (one daemon per project + client
registry) and Hybrid (daemon-owned registry, one active runtime). The
Hybrid variant was explicitly rejected because it cannot deliver
simultaneous supervision; the parent task captures the rationale.

This task is the daemon-side foundation. Sibling tasks consume the
registry surface for CLI, web, and native parity.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the
same daemon control contract.

## Acceptance Evidence

- `pnpm test` includes a daemon integration test that boots one daemon
  with two configured projects, runs a workflow in each, and asserts the
  resulting events, runs, and approvals never cross `projectId`.
- A typed test scans daemon-owned store constructors and fails if any
  store binds without a `projectId`.
- Contract-fixture diff shows the new identity / registry surface and
  the matching TypeScript + Swift decoders parse the fixture.
- Daemon transcript captured under `.kota/runs/<run-id>/transcript.txt`
  showing `kota status` + a `GET /identity` (or successor) response on a
  daemon configured with two projects.
