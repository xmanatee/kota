---
id: task-module-scaffold-cli
title: Add kota module new command to scaffold module starters
status: done
priority: p3
area: cli
summary: No CLI to bootstrap a new KOTA module. Contributors must read source to understand the required directory layout, TypeScript types, and contribution patterns before writing a single line of code.
created_at: 2026-03-30T17:44:28Z
updated_at: 2026-03-31T06:00:00Z
---

## Problem

Creating a new KOTA module requires knowing the `KotaModule` interface,
`extension_factory` export convention, required package.json shape, and how to
wire tools, agents, workflows, and channels. There is no `kota module new`
command and no template. Module authoring friction is high for newcomers and
wastes time even for contributors who know the codebase.

## Desired Outcome

`kota module new <name> [--dir <path>]` generates a minimal but complete
module starter:

- `package.json` with correct name, main entry, and kota peer dep reference.
- `src/index.ts` with a typed `extension_factory` export, a stub tool, and
  inline comments pointing at `KotaModule` field docs.
- `AGENTS.md` with directory purpose and role boundaries placeholder.
- An npm-installable shape (no extra build step required for simple modules).

The generated code must typecheck and load cleanly via the module loader.

## Constraints

- Generate only; do not install or modify any project config automatically.
- Follow the exact `extension_factory` / `KotaModule` contract as it exists
  in `src/modules/` — do not introduce a new API surface.
- Keep the scaffold minimal: one stub tool, no agents or workflows by default
  (those are easy to add once the shape is established).
- Register the command under `kota module new` alongside existing
  `kota module list` and `kota module inspect`.

## Done When

- `kota module new <name>` generates the files described above.
- The generated `src/index.ts` typechecks against the real `KotaModule` type.
- The generated module loads cleanly when added to `config.modules`.
- Command appears in `kota module --help`.
- `src/AGENTS.md` Key Modules entry added for the command registrar if a new
  file is created.
