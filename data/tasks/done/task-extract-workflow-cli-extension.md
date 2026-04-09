---
id: task-extract-workflow-cli-extension
title: Move workflow-cli into a dedicated workflow extension
status: done
priority: p2
area: architecture
summary: src/workflow-cli/ (25 files, ~4100 lines) is the largest remaining CLI surface in core. Moving it into src/extensions/workflow/ completes the systematic operator CLI migration and makes src/cli.ts a pure assembler of extension-contributed commands.
created_at: 2026-04-09T10:47:41Z
updated_at: 2026-04-09T11:58:00Z
---

## Problem

`src/workflow-cli/` owns all `kota workflow` subcommands: run list, show, step-inspect, follow,
trigger, control (pause/resume/abort/reload), validate, definitions, logs, gc, export, diff, cost,
and stats. The barrel file `src/workflow-cli.ts` imports from this directory and is imported
directly by `src/cli.ts`.

All other major operator CLI surfaces have been extracted into extensions (daemon, config, doctor,
secrets, approval-queue, agents, skills, repo-tasks, extension-manager, guardrails-audit, mcp-server).
The workflow CLI is the largest one still living in core.

## Desired Outcome

A new `src/extensions/workflow/` extension that:

- Owns the entire `workflow-cli/` directory (all files move inside the extension)
- Registers all `kota workflow` commands via `ctx.registerCliCommands()`
- Is listed in `builtinExtensions` in `src/extensions/index.ts`

`src/workflow-cli.ts` and `src/workflow-cli/` are removed from core. `src/cli.ts` no longer
imports `registerWorkflowCommands`. `src/AGENTS.md` Key Modules entries for workflow-cli are
removed; `src/extensions/AGENTS.md` is updated with the new extension entry.

## Constraints

- No change to command names, flags, aliases, or output.
- Relative imports within `workflow-cli/` gain one extra `../` level (`../../workflow/` etc.)
  since they move under `extensions/workflow/`; no public API changes are needed.
- The `cli.ts` test coverage for workflow commands continues to work — the commands are
  contributed by the extension the same way daemon and config commands are.
- `src/AGENTS.md` Key Modules section updated to remove workflow-cli entries.
- `src/extensions/AGENTS.md` Built-in Extensions section updated with the new `workflow` entry.

## Done When

- `kota workflow <all-subcommands>` work identically after the move.
- `src/workflow-cli.ts` and `src/workflow-cli/` are removed.
- `src/cli.ts` no longer imports from workflow-cli.
- All tests pass.
