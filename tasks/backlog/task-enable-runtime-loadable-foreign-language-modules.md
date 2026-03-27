---
id: task-enable-runtime-loadable-foreign-language-modules
title: Enable runtime-loadable foreign-language modules
status: backlog
priority: p2
area: extensions
summary: Support modules implemented outside the in-process TypeScript runtime once the module protocol is stable enough.
created_at: 2026-03-19T00:00:00Z
updated_at: 2026-03-27T19:00:00Z
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

## Done When

- The blocking protocol and runtime issues are resolved.
- A concrete external-module execution model exists and is ready to prototype.
- This task is moved to `ready/` with a sound implementation plan.
