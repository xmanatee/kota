---
id: task-extension-scaffold-cli
title: Add kota extension new command to scaffold extension starters
status: backlog
priority: p3
area: cli
summary: No CLI to bootstrap a new KOTA extension. Contributors must read source to understand the required directory layout, TypeScript types, and contribution patterns before writing a single line of code.
created_at: 2026-03-30T17:44:28Z
updated_at: 2026-03-30T17:44:28Z
---

## Problem

Creating a new KOTA extension requires knowing the `KotaExtension` interface,
`extension_factory` export convention, required package.json shape, and how to
wire tools, agents, workflows, and channels. There is no `kota extension new`
command and no template. Extension authoring friction is high for newcomers and
wastes time even for contributors who know the codebase.

## Desired Outcome

`kota extension new <name> [--dir <path>]` generates a minimal but complete
extension starter:

- `package.json` with correct name, main entry, and kota peer dep reference.
- `src/index.ts` with a typed `extension_factory` export, a stub tool, and
  inline comments pointing at `KotaExtension` field docs.
- `AGENTS.md` with directory purpose and role boundaries placeholder.
- An npm-installable shape (no extra build step required for simple extensions).

The generated code must typecheck and load cleanly via the extension loader.

## Constraints

- Generate only; do not install or modify any project config automatically.
- Follow the exact `extension_factory` / `KotaExtension` contract as it exists
  in `src/extensions/` — do not introduce a new API surface.
- Keep the scaffold minimal: one stub tool, no agents or workflows by default
  (those are easy to add once the shape is established).
- Register the command under `kota extension new` alongside existing
  `kota extension list` and `kota extension inspect`.

## Done When

- `kota extension new <name>` generates the files described above.
- The generated `src/index.ts` typechecks against the real `KotaExtension` type.
- The generated extension loads cleanly when added to `config.extensions`.
- Command appears in `kota extension --help`.
- `src/AGENTS.md` Key Modules entry added for the command registrar if a new
  file is created.
