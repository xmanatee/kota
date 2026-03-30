---
id: task-enable-runtime-loadable-foreign-language-modules
title: Enable runtime-loadable foreign-language modules
status: backlog
priority: p2
area: extensions
summary: Support modules implemented outside the in-process TypeScript runtime once the module protocol is stable enough.
created_at: 2026-03-19T00:00:00Z
updated_at: 2026-03-30T16:19:34Z
---

## Problem

The long-term goal includes hot-loadable modules and modules implemented in
other languages, but the current runtime still assumes in-process TypeScript
modules and tighter runtime coupling than that goal allows.

## Desired Outcome

KOTA should eventually support stable external-module boundaries that make
runtime-loaded or foreign-language modules realistic.

## Constraints

- Do not fake this with partial adapters that keep the old coupling underneath.
- The prerequisite is a cleaner, smaller module protocol.
- The extension rename cleanup is now complete. The remaining prerequisite is a concrete external-module execution model before implementation can begin.
- Do not couple the execution model to a specific IPC mechanism (stdio, HTTP, Unix socket) — the model should be transport-agnostic.

## Done When

- A concrete external-module execution model is designed and documented (protocol: capability declarations, tool invocation, lifecycle events).
- A working prototype loads at least one non-TypeScript extension (e.g., a Python script as a tool provider) via the defined protocol.
- Built-in extensions continue to work unchanged alongside the prototype.
- The prototype's protocol is stable enough to document in `docs/ARCHITECTURE.md`.
- This task is moved to `ready/` before prototyping begins with a full implementation plan.
