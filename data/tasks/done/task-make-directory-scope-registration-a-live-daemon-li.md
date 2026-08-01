---
id: task-make-directory-scope-registration-a-live-daemon-li
title: Make directory scope registration a live daemon lifecycle
status: done
priority: p1
area: architecture
task_class: Platform
summary: Make the persisted ScopeRegistry and ProjectRuntimeRegistry support transactional add, update, drain, and remove operations without daemon restart.
created_at: 2026-07-31T16:12:47.270Z
updated_at: 2026-08-01T11:17:28.093Z
---

## Problem

KOTA already has the right multi-scope primitives, but they are immutable after
daemon construction. `ScopeRegistry` explicitly omits add/remove/default
mutators, `ProjectRuntimeRegistry.create()` snapshots that registry once, and
the production daemon starts with only `projectDir`. The persisted
`project-registry.json` is overwritten from startup input, so it is a
checkpoint rather than an operator-owned live registry.

As a result, `/scopes` and `project ls/use` can only inspect or select scopes
that were injected programmatically. An operator cannot add a directory to a
running daemon, and a restart cannot reliably recover a live registration.

## Desired Outcome

Make the existing scope and runtime registries own one transactional live
lifecycle for directory scopes:

- Add or update a directory scope without restarting the daemon.
- Build and start exactly one per-scope runtime through
  `createProjectRuntime`, including workflow subscriptions and schedules.
- Drain and remove a runtime only after its active runs, sessions, approvals,
  task claims, and pending work have a typed disposition.
- Persist successful registry changes atomically and restore them on restart.
- Emit typed scope lifecycle events and immediately update `/scopes`,
  compatibility `/projects`, and project/scope selection.

## Constraints

- Evolve `ScopeRegistry` and `ProjectRuntimeRegistry`; do not add another
  project catalog, runtime factory, or filesystem scan as a second source.
- Treat the persisted machine-local registry as runtime authority after the
  initial daemon root is bootstrapped. Startup config may seed a missing
  registry but must not silently erase live registrations.
- Resolve and canonicalize directory identity, including symlinks, before
  duplicate detection. Reject a missing or inaccessible directory with a
  typed result.
- Registration is atomic across registry state and runtime creation. A failed
  runtime start leaves neither a persisted entry nor a partially subscribed
  runtime.
- Removal means stop hosting the scope. It must never delete, reset, clean, or
  otherwise modify the operator's project directory.
- The default scope cannot be removed until another default is selected.
- Keep `project` names only where required by the existing compatibility API;
  new lifecycle contracts use scope terminology.

## Done When

- A typed lifecycle service supports add, display-name update, default change,
  drain, and remove over the existing registries.
- A newly added scope can receive and execute a workflow before daemon restart,
  and the same registration is restored after restart.
- Runtime creation and teardown register/unregister schedules, event handlers,
  notification gates, stores, and resource leases exactly once.
- Unknown, duplicate, active, non-drainable, and default-scope removal cases
  return explicit outcomes without partial state.
- No production daemon path relies on `DaemonConfig.projects` as a separate
  long-lived registry after bootstrap.

## Source / Intent

Owner request on 2026-07-31: provide an easy Add Project flow where selecting
a folder lets KOTA begin autonomous work in that folder. The audit found the
foundation in `src/core/daemon/scope-registry.ts` and
`src/core/daemon/project-runtime.ts`, but both registries are fixed at startup
and production daemon construction does not pass `projects`.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- A lifecycle fixture adds a temp directory to a live daemon, observes it in
  `/scopes`, executes a scoped workflow, restarts, and observes the same stable
  scope id and one runtime.
- A removal fixture proves active work blocks removal, drained removal releases
  runtime resources, and the target directory remains byte-for-byte intact.
- A structural search artifact shows one scope registry, one project runtime
  factory, and no second production directory-to-runtime catalog.
