---
id: task-distribute-module-owned-config-slices-into-their-o
title: Distribute module-owned config slices into their owning modules
status: done
priority: p1
area: architecture
summary: Move per-slice TypeScript type declarations, sanitization, and merge logic from src/core/config/config.ts into each owning module by extending the existing configKeys hook into a typed configSlice contract, so adding a module's config field is a strictly module-local edit.
created_at: 2026-04-26T00:19:50.894Z
updated_at: 2026-04-26T00:49:31.815Z
---

## Problem

`src/core/config/config.ts` is 710 lines. Modules already declare top-level
config-key ownership through `KotaModule.configKeys`
(`task-module-config-extension-registry` + `task-align-config-validation-with-
module-config-keys`), so the unknown-key allowlist is no longer hard-coded in
core. What did **not** move out of core is the heart of those slices:

- The per-slice TypeScript field declarations on `KotaConfig` (`webhooks`,
  `tracing`, `mcp`, `failover`, `modelProvider`, `scheduler`, …) — every
  module-owned shape still lives next to genuinely cross-cutting fields.
- The per-slice sanitization clauses inside `sanitize()` (lines ~317–582).
- The per-slice merge clauses inside `mergeConfigs()` (lines ~595–642).

Adding a new top-level config field for any module today still requires
editing `src/core/config/config.ts` in three places. That is the same
asymmetry the recent `localClient`/`daemonClient` direction exists to remove
on the `KotaClient` side: handlers are module-owned, but their typed shape
and central wire code still grow inside core. Concretely, every module-owned
slice currently coupled to core has its only consumer in exactly one module:

- `webhooks` → `src/modules/webhook/webhook-operations.ts`
- `tracing` → `src/modules/tracing/index.ts`
- `mcp` → `src/modules/mcp-server/mcp-server-operations.ts` (+ `src/core/mcp/manager.ts`)
- `failover` + `modelProvider` → `src/modules/model-clients/{factory,index}.ts`
- `scheduler.dispatchWindow` / `agentConcurrency` / `codeConcurrency` →
  `src/modules/scheduler/index.ts`

`moduleMonitoring` (crash-loop alerting), `notifications.quietHours`,
`approvalTtlMs`, `serve`, `cli`, `daemon`, `workflow`, `runsGc`, `agentModels`,
`modelTiers`, `defaultAgentHarness`, `aliases`, `user`, `guardrails`,
`autoEnable`, and `foreignModules` are explicitly core (shared daemon/runtime
primitives per the architecture doc).

## Desired Outcome

Each module that owns a top-level config key contributes its slice end-to-end:

- The slice's TypeScript shape is declared in the owning module (e.g.
  `src/modules/<name>/config.ts` or alongside `index.ts`), not in
  `src/core/config/config.ts`.
- The module declares a typed `configSlice` (extending the existing
  `ModuleConfigKey` contract) carrying the slice's `sanitize` and `merge`
  callbacks. The loader collects them at module load time the same way it
  already collects `configKeys`.
- `KotaConfig` becomes a thin aggregate: it composes the core-owned fields
  inline and intersects in module-contributed slice types via a registry-
  derived index type. Migrating a slice into a module updates the aggregate
  type by composition only.
- `sanitize()` and `mergeConfigs()` shrink to:
  1. Sanitize/merge core-owned fields inline.
  2. Walk the registered module slices and apply their callbacks for any
     present key.
- A guard test rejects new per-slice TypeScript field declarations or
  per-slice sanitize/merge clauses inside `src/core/config/`.
- `src/core/config/config.ts` ends up under the repo's 300-line file-size
  guideline.

## Constraints

- One mechanism. Extend `KotaModule.configKeys` (or rename it to the typed
  `configSlices` form) — do not introduce a parallel registration path.
- The slice contract is strict: each slice declares (a) the key, (b) a
  description used for `kota config validate`, (c) a typed `sanitize(raw):
  Slice | undefined` callback, and (d) a typed `merge(base, override): Slice`
  callback. No optional / fallback fields on the contract itself.
- Existing config behavior is preserved exactly. This is an internal
  refactor. CLI surfaces (`kota config get/set/validate`), daemon startup
  warnings, and merged precedence (global < project < overrides) do not
  change.
- Core-owned slices stay in core: `moduleMonitoring`, `notifications`,
  `approvalTtlMs`, `serve`, `cli`, `daemon`, `workflow`, `runsGc`,
  `agentModels`, `modelTiers`, `defaultAgentHarness`, `aliases`, `user`,
  `guardrails`, `autoEnable`, `foreignModules`, `providers`, `modules`,
  `model`, `editorModel`, `maxTokens`, `thinking`, `thinkingBudget`,
  `verbose`, `skipConfirmations`, `reflection`. The architecture-doc
  boundary is the source of truth — quiet-hours gating and crash-loop
  alerting are core primitives.
- No legacy or compatibility shims. Delete the centralized type fields and
  sanitize/merge clauses as each slice migrates; do not leave dual paths.
- The `KotaConfig` aggregate type stays the single typed surface CLI and
  module code import. Per-slice types are imported from owning modules; the
  aggregate composes them via an index type.
- `kota config validate` and the unknown-key warning system continue to
  recognize loaded module slices.

## Done When

- Every module-owned slice (`webhooks`, `tracing`, `mcp`, `failover`,
  `modelProvider`, `scheduler`'s module-owned fields) declares its shape and
  its sanitize/merge callbacks in its owning module under `src/modules/<name>/`.
- `src/core/config/config.ts` declares only core-owned fields and a small
  loop that delegates to module-registered slices for sanitize/merge. The
  file is under the 300-line guideline.
- `KotaConfig` aggregates module-contributed slice types via a typed
  registry; CLI and module code that imports `KotaConfig` continues to see
  every previously valid field.
- A guard test under `src/core/config/` rejects per-slice field declarations
  and per-slice sanitize/merge clauses for any module-owned key.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Operator transcript (or scripted fixture) demonstrates `kota config validate`
  accepting and rejecting one mutation per migrated slice the same way it
  did before the refactor.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T00-17-04-496Z-explorer-uoxn8a/` after the queue
emptied to 0 backlog / 0 ready / 0 doing on 2026-04-26 (commit `7b2d79ee`).
The recently-completed model-pricing seam extraction (commit `85de2f7a`),
the operator-CLI cluster (commit `a7214b7d`), and the in-flight kotaclient
namespace distribution (`task-distribute-kotaclient-namespace-types-and-
daemon-s`, blocked on owner chunking decision) are all the same direction:
modules own their public surface end-to-end; core shrinks to genuine
cross-cutting protocols and runtime primitives. Config is the next visible
asymmetry — slice consumers already live in modules, but slice declarations
and sanitize/merge logic remain centralized.

This task is intentionally scoped smaller than the kotaclient distribution
(6 module-owned slices, ~700 lines) so it can land in one cohesive builder
run without the chunking question that blocked the kotaclient task.

## Initiative

Module-first, core-shrinking architecture: every module-owned capability —
including its config slice — lives in the owning module, with `src/core/`
reduced to genuine cross-cutting protocols and runtime primitives.

## Acceptance Evidence

- Diff covering slice-type and sanitize/merge moves out of
  `src/core/config/config.ts`, the new typed `configSlice` hook on
  `KotaModule`, the loader wiring, and the new guard test.
- Line-count snapshot of `src/core/config/config.ts` showing it under 300
  lines after the refactor.
- `kota config validate` transcript showing accept and reject behavior on a
  representative `webhooks`, `tracing`, `mcp`, `failover`, and `scheduler`
  payload — confirming parity with pre-refactor sanitization.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` outputs.
