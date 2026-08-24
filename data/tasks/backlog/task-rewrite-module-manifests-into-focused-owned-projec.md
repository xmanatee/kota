---
id: task-rewrite-module-manifests-into-focused-owned-projec
title: Rewrite module manifests into focused owned projections
status: backlog
priority: p2
area: architecture
task_class: Platform
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Separate manifest contracts and validation from effect, event-flow, setup, and simulation projections without parallel paths.
created_at: 2026-08-24T02:13:46.461Z
updated_at: 2026-08-24T02:13:46.461Z
---

## Problem

`module-manifest.ts` combines public contract types, registries, validation,
workflow event-flow analysis, effect derivation, setup projection, and
simulation support. The resulting 1,000-line authority has multiple reasons to
change and makes its global projection registry difficult to reason about.

## Desired Outcome

Rewrite the manifest subsystem around one canonical manifest contract with
focused owners for schema validation, registered projections, event-flow
derivation, effects/simulation, and setup availability. Module loading builds
one projection by composing those owners; inspection reads that projection.

## Constraints

- Keep the module manifest the sole capability/effect authority; do not create
  separate catalogs for UI, doctor, simulation, or automation explanation.
- Preserve strict validation and fail loudly on inconsistent capability,
  effect, setup, or event links.
- Remove global mutable registration where loader-owned lifecycle state can
  provide explicit ownership and cleanup.
- Move callers and tests to the focused boundaries, then delete the mixed
  implementation rather than retaining forwarding aliases.

## Done When

- Contract/schema types, validation, registry lifecycle, event flows,
  effect/simulation projection, and setup projection each have one focused
  owner and explicit inputs/outputs.
- Module load/unload/reload cannot leak or retain stale manifest state.
- UI, doctor, explain, and simulation consumers derive from the same built
  projection.
- The original mixed-responsibility implementation and any compatibility
  exports are removed.

## Source / Intent

Owner-approved targeted rewrite from the 2026-08-24 architecture audit after
reviewing the file's distinct validation, registry, event, effect, setup, and
simulation responsibilities.

## Initiative

Clean module-runtime ownership with one capability manifest.

## Acceptance Evidence

- Module load/unload/reload integration fixtures proving projection ownership
  and cleanup.
- Deliberate invalid-manifest fixtures for every cross-link boundary.
- Import/state report proving one canonical manifest assembly and no stale
  compatibility export path.
