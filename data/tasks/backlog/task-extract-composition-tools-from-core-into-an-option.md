---
id: task-extract-composition-tools-from-core-into-an-option
title: Extract composition tools from core into an optional module
status: backlog
priority: p2
area: architecture
summary: The batch, pipe, and map tools live in src/core/tools/ but are general-purpose composition utilities, not core primitives. Moving them to a module shrinks core and aligns with the module-first architecture goal.
created_at: 2026-04-12T16:39:05.420Z
updated_at: 2026-04-12T16:39:05.420Z
---

## Problem

`src/core/tools/` contains `batch.ts`, `pipe.ts`, and `map.ts` — composition
utilities that let agents run tools in parallel, chain tool outputs, or apply a
tool across a list. These are useful but not core primitives. The core boundary
documented in AGENTS.md says core should own the agent/session loop, tool
protocols, module loading, workflow runtime, and guardrails. Composition
helpers are opt-in conveniences that belong in a module.

Keeping them in core inflates the core surface and makes it harder to reason
about what is essential versus optional.

## Desired Outcome

A new `composition` module (or similar name) in `src/modules/` owns the batch,
pipe, and map tools. Core no longer registers them directly. The module
contributes them via the standard tool contribution protocol so they are
available to any agent whose module set includes it.

## Constraints

- Move the existing tool implementations and their tests without behavior
  changes.
- Ensure the default module set still includes composition so existing agents
  are not broken.
- Do not introduce a compatibility shim or re-export from core.
- `prompt-template` is a separate concern — evaluate independently.

## Done When

- `batch`, `pipe`, and `map` tools are contributed by a module in `src/modules/`.
- Their source files and tests no longer exist under `src/core/tools/`.
- Existing tests pass without modification beyond import path changes.
- The default agent module set includes the new module.
