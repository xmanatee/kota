# Manifest

This directory contains manifest-defined execution, validation, persistence, and step handling for agent-authored modules.

- Manifest modules provide a declarative way for agents to create persistent custom tools via JSON (`extension_factory`).
- The manifest format supports `tools`, `name`, `version`, `description`, and `dependencies`.
- `eventHandlers` and `scripts` (manifest-era automation paths) have been removed; use contributed workflows and tools instead.
- `steps.ts` provides step pipeline utilities (`evaluateCondition`, `resolveStepInput`) shared with the `pipe` tool.
- If a capability belongs to the shared step language or workflow runtime instead, move it there instead of duplicating semantics.
