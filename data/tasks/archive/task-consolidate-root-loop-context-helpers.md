---
status: done
---

# Move root loop and context helpers into core loop boundaries

## Problem

Several root files are loop/session concerns rather than public entrypoints:
`instruction-files.ts`, `project-context.ts`, `request-analyzer.ts`,
`observation-masking.ts`, and `verify-tracker.ts`. Core loop files import them
through `#root`, which keeps root as an implicit core extension area.

## Desired Outcome

Move these helpers into the most natural `src/core/loop/`, `src/core/agents/`,
or other core subdirectory and update imports.

## Constraints

- Keep the task limited to loop/context/verification helpers.
- Do not change agent behavior except where imports or local paths require it.
- Do not introduce barrels or compatibility wrappers.
- Keep docs and local `AGENTS.md` files aligned.

## Done When

- The selected helpers are no longer root `src/*.ts` files.
- Core loop imports use `#core/*` or local sibling imports.
- Modules do not need to know about root helper locations.
- Existing source-mode and built-runtime imports still resolve cleanly.
