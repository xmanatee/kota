---
id: task-remove-public-module-terminology
title: Remove remaining public module terminology from extension-facing APIs
status: done
priority: p1
area: architecture
summary: The public concept model is now `extension`, but user-facing config and diagnostics still expose `module` wording such as `config.modules` and `[module:<name>]`. Finish the visible rename so docs and runtime surfaces speak one language.
created_at: 2026-03-27T16:06:00Z
updated_at: 2026-03-27T18:12:02Z
---

## Problem

KOTA's architecture docs say `extension` is the integration concept, but
public-facing surfaces still leak the older `module` model:

- `config.modules` as the extension config surface
- `[module:<name>]` prefixes in extension logs and user-visible diagnostics

That leaves the docs cleaner than the actual public API and keeps the old model
alive in places users and extension authors still see.

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

- `config.modules` is replaced by an extension-named config surface.
- Extension log/diagnostic prefixes no longer use `[module:...]`.
- No public extension-facing API or visible diagnostic surface still presents
  extensions as "modules".
- `npm run typecheck` and `npm test` pass.
