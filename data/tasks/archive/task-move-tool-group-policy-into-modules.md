---
status: done
---

# Move tool-group policy out of core and let modules describe their own groups

## Problem

General-purpose capability packs have largely moved into `src/modules/<name>/`, but
tool activation policy still depends on a central core file (`src/tool-groups.ts`) that
hardcodes group names, group membership, and "core tool" allowlists. That keeps a
meaningful part of module capability policy outside the module boundary and makes
new capability packs less plug-and-play than they should be.

## Desired Outcome

Modules can declare the tool-group metadata they need so the runtime no longer depends
on a large central hardcoded mapping for built-in capability packs. Core keeps only the
minimal protocol and activation machinery; module-specific grouping policy lives with
the module that owns the tools.

## Constraints

- Preserve the current `enable_tools` UX; the operator-facing concept of named groups can
  stay the same.
- Do not reintroduce parallel module metadata surfaces or compatibility shims.
- Keep the runtime protocol simple: one clear place for tool-group metadata, with the
  built-in modules using the same path as external ones.
- Update docs and any local `AGENTS.md` inventories that would otherwise become stale.

## Done When

- Built-in module tool groups are no longer centrally hardcoded in `src/tool-groups.ts`.
- A built-in module can declare its tool-group metadata without editing a shared
  allowlist in core.
- `enable_tools` still lists and enables the same operator-facing groups after the move.
- Tests cover module-declared group registration and cleanup on unload.
