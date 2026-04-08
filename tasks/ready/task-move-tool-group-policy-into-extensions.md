---
id: task-move-tool-group-policy-into-extensions
title: Move tool-group policy out of core and let extensions describe their own groups
status: ready
priority: p2
area: architecture
summary: Tool-group activation and core tool allowlists still live in src/tool-groups.ts, which keeps extension capability policy centralized in core. Extension-owned group metadata would make capability packs more plug-and-play and reduce remaining core-heavy policy.
created_at: 2026-04-08T19:43:33Z
updated_at: 2026-04-08T19:43:33Z
---

## Problem

General-purpose capability packs have largely moved into `src/extensions/<name>/`, but
tool activation policy still depends on a central core file (`src/tool-groups.ts`) that
hardcodes group names, group membership, and "core tool" allowlists. That keeps a
meaningful part of extension capability policy outside the extension boundary and makes
new capability packs less plug-and-play than they should be.

## Desired Outcome

Extensions can declare the tool-group metadata they need so the runtime no longer depends
on a large central hardcoded mapping for built-in capability packs. Core keeps only the
minimal protocol and activation machinery; extension-specific grouping policy lives with
the extension that owns the tools.

## Constraints

- Preserve the current `enable_tools` UX; the operator-facing concept of named groups can
  stay the same.
- Do not reintroduce parallel extension metadata surfaces or compatibility shims.
- Keep the runtime protocol simple: one clear place for tool-group metadata, with the
  built-in extensions using the same path as external ones.
- Update docs and any local `AGENTS.md` inventories that would otherwise become stale.

## Done When

- Built-in extension tool groups are no longer centrally hardcoded in `src/tool-groups.ts`.
- A built-in extension can declare its tool-group metadata without editing a shared
  allowlist in core.
- `enable_tools` still lists and enables the same operator-facing groups after the move.
- Tests cover extension-declared group registration and cleanup on unload.
