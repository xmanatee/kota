---
id: task-add-per-project-projectruntime-bundle-factory-and-
title: Add per-project ProjectRuntime bundle factory and singleton-binding invariant test
status: done
priority: p2
area: architecture
summary: Convert workflow runtime, run store, task store, scheduler, module-log store, notification gate, approval queue, owner-question queue, and push-token store to per-project bundles keyed by ProjectId, with a typed singleton-binding invariant test.
created_at: 2026-05-08T00:56:56.663Z
updated_at: 2026-05-08T03:13:14.008Z
---

## Problem

The `ScopeRegistry` primitive exists (`src/core/daemon/scope-registry.ts`)
and `DaemonConfig.projects` accepts more than one configured project, but
every daemon-owned subsystem still binds to a single `projectDir` at
construction. Today the daemon constructs one `WorkflowRunStore`, one
`Scheduler`, one `TaskStore`, one module-log store, one `NotificationGate`,
one `ApprovalQueue`, one `OwnerQuestionQueue`, and one push-token store
against the registry's *default* project. When the daemon hosts two projects,
state silently leaks across them because the stores share file paths and
in-memory state.

There is no mechanical guard against a new subsystem forgetting to declare
project scope, so the leak risk grows every time a new daemon-owned store
lands.

## Desired Outcome

A typed `ProjectRuntime` bundle factory exists in the daemon core. For each
configured project, the daemon constructs one bundle holding that project's
workflow runtime, run store, task store, scheduler, module-log store,
notification gate, approval queue, owner-question queue, and push-token
store. The runtime context exposes a typed lookup
(`getProjectRuntime(projectId)`) so consumers always reach the right store
for the right project.

A typed invariant test scans daemon-owned store/factory constructors and
fails if any subsystem binds to `projectDir` outside the per-project
bundle. New stores that need project scope must register through the bundle.

## Constraints

- One daemon-owned bundle factory. Stores keep their existing typed
  constructors (most already accept `projectDir`); the bundle wires them per
  project.
- Strict typed scope. The bundle exposes typed accessors per store; no
  nullable fall-through to a global root.
- KOTA-on-itself with one configured project produces the same observable
  behavior as today.
- The invariant test runs as part of the standard `pnpm test` pipeline and
  fails loudly when a new singleton store binding is introduced.
- No client-API or wire-format changes in this task — those land in the
  control-API and event-bus follow-ups.

## Done When

- A typed `ProjectRuntime` bundle factory in `src/core/daemon/` constructs
  per-project instances of all nine stores listed above.
- The daemon constructor builds one bundle per registered project; the
  runtime context exposes a typed accessor by `projectId`.
- A typed invariant test rejects new singleton store bindings (e.g. by
  scanning the daemon source tree for `init*(projectDir)` or
  `new XStore(projectDir)` calls outside the bundle factory).
- All existing daemon tests still pass; tests that previously read singleton
  state from a global module are updated to read from the per-project bundle.
- A new focused test asserts that two projects' bundles are independent
  (separate file paths, separate in-memory state).

## Source / Intent

Decomposition slice 2 of the daemon foundation for multi-project supervision
(parent: `task-surface-project-selection-in-operator-clients-for-`,
foundation: `task-add-daemon-project-registry-and-projectid-attribut`).
The foundation task delivered the registry primitive and DaemonConfig
plumbing; this slice converts the runtime bundles so the registry actually
holds independent state per project.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the same
daemon control contract.

## Acceptance Evidence

- `pnpm test` includes a focused test that constructs two bundles for two
  projects and asserts they share no in-memory state and write to distinct
  per-project file paths.
- The singleton-binding invariant test runs as part of the daemon test
  suite and fails when a new store skips the bundle.
