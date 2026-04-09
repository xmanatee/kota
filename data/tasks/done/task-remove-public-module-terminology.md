---
id: task-remove-public-module-terminology
title: Remove remaining public module terminology from extension-facing APIs
status: done
priority: p1
area: architecture
summary: The public concept model is now `extension`, but manifest and extension-factory surfaces still expose `module` wording such as `ModuleManifest`, manifest module diagnostics, and loaded-module state helpers. Finish the visible rename so docs and runtime surfaces speak one language.
created_at: 2026-03-27T16:06:00Z
updated_at: 2026-03-28T00:00:00Z
---

## Problem

KOTA's architecture docs say `extension` is the integration concept, but
public-facing manifest and extension-factory surfaces still leak the older
`module` model:

- `ModuleManifest` and manifest-module wording in `src/manifest/*`
- manifest load/validation diagnostics such as `Manifest module "<name>" ...`
- loaded-module helper/state names in `src/tools/extension-factory/*`

The earlier public cleanup removed some visible drift, but the public API and
diagnostics still do not speak one language end to end.

## Desired Outcome

- Public extension-facing APIs, config, and diagnostics use `extension`
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

- Manifest and extension-factory public APIs use `extension` terminology
  consistently.
- Public diagnostics no longer describe extensions as "modules".
- No public extension-facing API or visible diagnostic surface still presents
  extensions as "modules".
- `npm run typecheck` and `npm test` pass.
