---
id: task-strengthen-self-contained-module-boundaries
title: Strengthen self-contained module boundaries
status: done
priority: p1
area: modules
summary: Move modules closer to genuinely self-contained, pluggable capabilities instead of thin files over core internals.
created_at: 2026-03-19
updated_at: 2026-03-19

## Resolution

Extracted `ToolResult` and `ToolResultBlock` from `src/tools/index.ts` into
`src/tools/tool-result.ts`. Updated `src/module-types.ts` and
`src/tool-adapters.ts` to import directly from `tool-result.ts` rather than
through `tools/index.ts`. `tools/index.ts` re-exports both types unchanged, so
no other files needed updating.

This removes the coupling where the KotaModule protocol (`module-types.ts`)
depended on the entire tool implementation bundle to resolve a single shared
type.
---

## Problem

The current module system is useful, but some modules still feel too coupled to
core runtime assumptions and do not yet deliver the fully plug-and-play model
the repo is aiming for.

## Desired Outcome

Modules should expose clearer boundaries, depend on stable protocols, and feel
more like swappable capabilities than thin wrappers around core code.

## Constraints

- Favor protocol cleanup over adding more module features.
- Keep the runtime understandable.
- Do not introduce compatibility shims to preserve weak boundaries.

## Done When

- A meaningful module-boundary weakness is removed.
- The resulting protocol is easier to reason about for future module work.
- Validation covers the changed boundary.
