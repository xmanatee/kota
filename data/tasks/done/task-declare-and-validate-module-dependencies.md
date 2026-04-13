---
id: task-declare-and-validate-module-dependencies
title: Declare and validate module-to-module dependencies
status: done
priority: p1
area: modules
summary: Several modules import other modules directly without declaring dependencies, weakening unload/reload ordering and module boundary clarity.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T15:26:25.346Z
---

## Problem

The module protocol has a `dependencies` field, but most project modules do not
use it. Several modules import other modules directly: autonomy imports
workflow-ops helpers, telegram imports approval-queue, web imports web-ui, and
slack/webhook import a top-level shared notification helper. Those relationships
are real runtime dependencies, but the loader cannot reason about them for
ordering, unload, reload, or health summaries.

This creates a mismatch between the module API and the actual source graph.

## Desired Outcome

Module-to-module coupling is explicit. Direct imports are either replaced by a
core protocol/provider/event/tool boundary, or the importing module declares the
dependency and tests enforce that declaration. The loader and lifecycle behavior
match the code graph.

## Constraints

- Do not ban local imports inside the same module.
- Do not over-abstract stable same-domain helpers; use declared dependencies
  where that is the honest boundary.
- Do not leave dependencies implicit because the current default module set
  happens to load everything.
- Prefer core protocols only when they genuinely remove coupling rather than
  relocating it.

## Done When

- Production `#modules/*` imports across module boundaries are audited.
- Every remaining cross-module production import is backed by a declared module dependency.
- Unload/reload tests cover refusal to unload a module with direct dependents.
- Documentation or local `AGENTS.md` states the dependency convention close to `src/modules/`.
