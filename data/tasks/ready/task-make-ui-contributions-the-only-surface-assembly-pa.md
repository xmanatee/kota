---
id: task-make-ui-contributions-the-only-surface-assembly-pa
title: Make UI contributions the only surface assembly path
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Replace the split static contribution plus manual daemon bundle with one live, validated, module-owned UI surface assembly mechanism.
created_at: 2026-07-31T16:00:53.450Z
updated_at: 2026-07-31T16:00:53.450Z
---

## Problem

KOTA declares `KotaModule.uiSurfaces` as the module contribution boundary, but
the loader resolves and caches those surfaces at module load. Live operator
facts cannot use that static path, so `buildSharedUiSurfaceBundle` in
`src/modules/daemon-ops/index.ts` manually gathers every domain and hardcodes a
second list of status, scope, inbox, continuity, runtime, module, setup, and
store surface builders before appending module contributions. Only
`operator-control` currently enters through `uiSurfaces`.

The result is two assembly mechanisms and misplaced ownership: adding or
changing an operator capability can require editing the central daemon-ops
bundle instead of the module that owns the capability.

## Desired Outcome

Evolve the existing UI contribution boundary into the one live, scope-aware
surface assembly mechanism. Capability-owning modules contribute a typed live
surface source; the daemon endpoint and `KotaClient.ui` resolve, validate,
order, and return those contributions without a second hardcoded surface list.

## Constraints

- Evolve `KotaModule.uiSurfaces`; do not add a parallel UI registry or API.
- Keep contribution registration deterministic and side-effect free. Live
  reads happen through an explicit read context at projection time, not by
  rerunning arbitrary module lifecycle hooks.
- Preserve strict duplicate extension/surface/action id validation and make a
  contributor failure a typed unavailable/error surface or a loud protocol
  failure; do not silently omit it.
- Keep native rendering outside this task. The CLI remains the reference
  consumer of the shared graph and `src/modules/rendering/` remains the only
  terminal rendering DSL.
- A module owns the semantics for its capability; daemon-ops may still own
  daemon-runtime status/control surfaces, but not a catalog of other modules.

## Done When

- The module runtime exposes one typed live UI contribution contract and one
  bundle assembler used by both `/ui/surfaces` and `KotaClient.ui`.
- Existing status, scopes, inbox, continuity, runs, modules/agents, setup,
  stores, and operator controls are registered through that mechanism by their
  owning modules.
- `buildSharedUiSurfaceBundle` no longer contains a manually maintained list
  that bypasses module contributions, and no second contribution registry
  remains.
- Loading, reloading, scope selection, duplicate ids, contributor failure, and
  action lookup all have focused fixture coverage through the same projection.

## Source / Intent

Owner architecture request on 2026-07-31: every capability should have one
correct declaration and execution mechanism, with interfaces defined once and
rendered by clients rather than reimplemented per surface. Audit evidence:
`src/core/modules/module-types.ts` defines `uiSurfaces`,
`src/core/modules/module-loader-load-phases.ts` caches it at load, while
`src/modules/daemon-ops/index.ts` separately builds the live bundle and only
then appends `ctx.getContributedUiSurfaces()`.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A run artifact containing the module-to-surface ownership projection and a
  captured `kota ui render --json` bundle assembled only from contributors.
- A structural search artifact proving there is no hardcoded central live
  surface-builder list outside contributor declarations.
- Focused validation output for duplicate ids, reload, scope, typed contributor
  failure, and action execution through the unified projection.
