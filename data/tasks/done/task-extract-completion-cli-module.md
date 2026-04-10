---
id: task-extract-completion-cli-module
title: Move completion-cli.ts into a dedicated completion module
status: done
priority: p2
area: architecture
summary: src/completion-cli.ts (205 lines) implements kota completion [bash|zsh] and lives as a standalone core file. Moving it into a new src/modules/completion/ module continues the operator CLI surface migration.
created_at: 2026-04-09T10:34:06Z
updated_at: 2026-04-09T12:30:00Z
---

## Problem

`src/completion-cli.ts` registers the `kota completion` command and generates
shell completion scripts by introspecting the commander program at runtime. It
is imported directly by `src/cli.ts`. The introspection requirement (access to
the fully-built commander `program` object) is the main constraint: the module
must be loaded and receive the program reference after all other CLI commands are
registered.

## Desired Outcome

A new `src/modules/completion/` module that:

- Owns `completion-cli.ts` logic (bash/zsh generators, shell detection, `registerCompletionCommands`)
- Contributes the `kota completion` command through the normal module `commands` surface
- Is automatically discovered from its module directory without a central registry edit

`src/completion-cli.ts` is removed and `src/cli.ts` no longer imports from it directly.

## Constraints

- No change to command name, flags, or output.
- Shell detection and script generation logic stays functionally identical.
- The module must receive the commander program with all other commands already
  registered so introspection returns a complete command tree.
- `src/AGENTS.md` Key Modules entry removed; `src/modules/AGENTS.md` updated.

## Done When

- `kota completion bash` and `kota completion zsh` output identical scripts after the move.
- `src/completion-cli.ts` is removed.
- `src/cli.ts` no longer imports `registerCompletionCommands`.
- All tests pass.
