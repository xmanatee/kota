---
id: task-enforce-strict-module-tool-metadata
title: Enforce strict metadata for module-contributed tools
status: done
priority: p1
area: modules
summary: Module tools can currently omit risk and kind metadata, causing guardrails to default to unclassified behavior instead of enforcing the tool protocol.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:41:59.519Z
---

## Problem

The module tool protocol says every tool has a schema, runner, risk, and
capability kind, but `ToolDef.risk` and `ToolDef.kind` are optional. The module
loader only prints a warning when metadata is absent, then registers the tool
without a complete protocol record. Current project modules already expose this
gap: `knowledge` and `working_memory` register without risk/kind metadata.

This weakens guardrails and makes malformed internal module definitions look
valid. It also conflicts with the repository standard to prefer strict typed
protocols over defaults and fallbacks.

## Desired Outcome

Module-contributed tools must provide complete risk and kind metadata before
they can load. Existing project modules provide explicit metadata. The type
surface and tests make omission impossible or fail loudly.

## Constraints

- Do not keep a default risk/kind path for project-owned modules.
- Do not add a compatibility shim or alternate loose tool definition path.
- Preserve foreign-module and adapter behavior only if they normalize external
  input into a complete internal `ToolDef`.
- Keep the fix protocol-level, not a one-off patch for two modules.

## Done When

- `ToolDef.risk` and `ToolDef.kind` are required in the internal module protocol.
- `knowledge` and `working-memory` tools declare explicit metadata.
- Module loading rejects missing risk/kind instead of warning and continuing.
- Tests cover missing metadata rejection and successful loading of complete tool definitions.
