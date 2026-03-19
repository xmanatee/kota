---
id: task-enable-runtime-loadable-foreign-language-modules
title: Enable runtime-loadable foreign-language modules
status: blocked
priority: p2
area: modules
summary: Support modules implemented outside the in-process TypeScript runtime once the module protocol is stable enough.
created_at: 2026-03-19
updated_at: 2026-03-19
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
- This is blocked until the current module boundary work is simpler and more stable.

## Done When

- The blocking protocol and runtime issues are resolved.
- A concrete external-module execution model is viable.
- The task can move back to `backlog/` or `ready/` with a sound plan.
