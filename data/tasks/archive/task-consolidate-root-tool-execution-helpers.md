---
status: done
---

# Move root tool and execution helpers into owning modules or core tools

## Problem

Some root files are tool or execution support rather than root entrypoints:
`lint.ts`, `path-resolver.ts`, `repl-session.ts`, `confirm.ts`, and
`error-context.ts`. They are used by filesystem, execution, and core tool paths,
but their root placement makes ownership ambiguous.

## Desired Outcome

Move each helper to its owning module or core tool area, choosing the smallest
clear destination for each file.

## Constraints

- Do not turn this into a broad root cleanup.
- Do not add re-export facades.
- Keep behavior unchanged unless a bug is discovered while moving.
- Preserve the distinction between swappable capability code and core tool
  runtime primitives.

## Done When

- The moved helpers have clear owners under `src/core/` or `src/modules/`.
- Production imports no longer depend on their old root paths.
- Local `AGENTS.md` files explain any non-obvious ownership choices.
- The remaining root files are closer to public entrypoints or thin glue.
