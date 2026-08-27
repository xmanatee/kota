---
status: done
---

# Move init-cli.ts into a dedicated init module

## Problem

`src/init-cli.ts` registers the `kota init` command, which scaffolds a new KOTA project
with config, task directories, docs stubs, and `.kota/`. It is imported directly by
`src/cli.ts`. Like other operator CLI surfaces, it belongs in an module.

## Desired Outcome

A new `src/modules/init/` module that:

- Owns `init-cli.ts` logic (`runInit`, `registerInitCommand`)
- Contributes `kota init` through the normal module `commands` surface
- Is automatically discovered from its module directory without a central registry edit

`src/init-cli.ts` is removed. `src/cli.ts` no longer imports from it.

## Constraints

- No change to command name, flags, or scaffolded output.
- `src/AGENTS.md` Key Modules entry removed; `src/modules/AGENTS.md` updated.

## Done When

- `kota init` scaffolds identically after the move.
- `src/init-cli.ts` is removed.
- `src/cli.ts` no longer imports `registerInitCommand`.
- All tests pass.
