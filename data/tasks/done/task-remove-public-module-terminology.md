---
id: task-remove-public-module-terminology
title: Remove remaining public module terminology from module-facing APIs
status: done
priority: p1
area: architecture
summary: The public concept model is now `module`, but manifest and module-factory surfaces still expose `module` wording such as `ModuleManifest`, manifest module diagnostics, and loaded-module state helpers. Finish the visible rename so docs and runtime surfaces speak one language.
created_at: 2026-03-27T16:06:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

KOTA's architecture docs say `module` is the integration concept, but
public-facing manifest and module-factory surfaces still leak the older
`module` model:

- `ModuleManifest` and manifest-module wording in `src/manifest/*`
- manifest load/validation diagnostics such as `Manifest module "<name>" ...`
- loaded-module helper/state names in `src/tools/module-factory/*`

The earlier public cleanup removed some visible drift, but the public API and
diagnostics still do not speak one language end to end.

## Desired Outcome

- Public module-facing APIs, config, and diagnostics use `module`
  terminology consistently.
- Old `module` names are removed instead of left alive in visible runtime
  surfaces.
- Docs and tests match the actual public surface.

## Constraints

- Do not add aliases or compatibility shims for old names.
- Keep the change conceptually focused on public terminology and API surface,
  not unrelated refactors.
- Coordinate with the in-flight internal terminology cleanup rather than
  duplicating it.

## Done When

- Manifest and module-factory public APIs use `module` terminology
  consistently.
- Public diagnostics no longer describe modules as "modules".
- No public module-facing API or visible diagnostic surface still presents
  modules as "modules".
- `npm run typecheck` and `npm test` pass.
