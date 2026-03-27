---
id: task-remove-public-module-terminology
title: Remove remaining public module terminology from extension-facing APIs
status: done
priority: p1
area: architecture
summary: The public concept model is now `extension`, but user-facing surfaces still expose `module_factory`, `getModuleConfig`, and module-oriented wording. Finish the public rename so docs, prompts, tools, and extension APIs all speak one language.
created_at: 2026-03-27T16:06:00Z
updated_at: 2026-03-27T16:06:00Z
---

## Problem

KOTA's architecture docs now say `extension` is the only integration concept,
but public-facing surfaces still leak the older `module` model:

- the `module_factory` tool name and related help text
- `getModuleConfig` on the extension context
- tests, prompts, and docs that still present extension behavior as "modules"

That leaves the docs cleaner than the actual public API and keeps the old model
alive in places users and extension authors still see.

## Desired Outcome

- Public extension-facing APIs, tools, and help text use `extension`
  terminology consistently.
- Old `module` names that are still part of the public extension/tool model are
  removed rather than left as parallel concepts.
- Tests and docs are updated so the public story matches the runtime surface.

## Constraints

- Do not add aliases or compatibility shims for old names.
- Keep the change conceptually focused on public terminology and API surface,
  not unrelated refactors.
- Coordinate with the in-flight internal terminology cleanup rather than
  duplicating it.

## Done When

- The user-facing `module_factory` surface is renamed or replaced with
  extension-oriented terminology.
- `getModuleConfig` no longer appears as the public config accessor on
  extension context types.
- Docs and prompts that describe extension authoring use one consistent
  `extension` vocabulary.
- `npm run typecheck` and `npm test` pass.
