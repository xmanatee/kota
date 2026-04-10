---
id: task-move-registry-helpers-to-core-modules
title: "Move registry and module-install helpers from src/ root to src/core/modules/"
status: done
priority: p2
area: architecture
summary: "registry.ts, registry-source.ts, and registry-installers.ts are module-system infrastructure sitting as loose root files. Moving them into src/core/modules/ completes the module-system ownership boundary."
created_at: 2026-04-11T00:10:00Z
updated_at: 2026-04-11T00:10:00Z
---

## Problem

The module registry and installer code (`registry.ts`, `registry-source.ts`,
`registry-installers.ts`) lives at the `src/` root despite being clearly owned
by the module system. `src/core/modules/` already exists and owns module
protocol and lifecycle — these files belong there.

## Desired Outcome

All three files live under `src/core/modules/`, imports are updated, and the
local `AGENTS.md` reflects the addition.

## Constraints

- No compatibility shims.
- Do not refactor the files, just move and re-wire imports.
- Update `AGENTS.md` files that reference old paths.

## Done When

- The three files are in `src/core/modules/` with correct imports.
- Build, typecheck, lint, and tests pass.
