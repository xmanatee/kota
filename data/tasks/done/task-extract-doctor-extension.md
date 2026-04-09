---
id: task-extract-doctor-module
title: Move doctor-cli.ts into a dedicated doctor module
status: done
priority: p2
area: architecture
summary: doctor-cli.ts (369 lines) contributes one CLI command (kota doctor) but lives as a standalone core file imported directly by cli.ts. Following the established pattern of moving operator CLI commands into their owning modules would shrink core and put doctor alongside its check logic as a cohesive unit.
created_at: 2026-04-09T07:21:47Z
updated_at: 2026-04-09T09:07:00Z
---

## Problem

`src/doctor-cli.ts` registers `kota doctor` health checks and is imported directly by `src/cli.ts`. Every other operator CLI surface (approvals, audit, agents, skills, tasks, modules, scheduler) has been migrated into its owning module directory. The doctor command is the one significant CLI surface still living as a standalone core file.

## Desired Outcome

A new `src/modules/doctor/` module that:

- Owns `doctor-cli.ts` logic, moved to `src/modules/doctor/index.ts` or `src/modules/doctor/cli.ts`
- Registers the `kota doctor` command via `ctx.registerCliCommands()`
- Is listed in `repoExtensions` in `src/modules/index.ts`

`src/doctor-cli.ts` is removed and `src/cli.ts` no longer imports from it directly.

## Constraints

- No change to `kota doctor` output, check behavior, or exit codes.
- The module may import from core (config, module-loader, etc.) as needed — this is not a strict isolation boundary change, just a layout migration.
- `src/modules/AGENTS.md` Built-in Modules list is updated with the new entry.
- `src/AGENTS.md` Key Modules is updated to remove the old entry.

## Done When

- `src/modules/doctor/` exists and the `kota doctor` command works identically.
- `src/doctor-cli.ts` is removed.
- `src/cli.ts` no longer imports from doctor-cli.ts.
- All existing doctor tests pass (or are co-located with the new module).
- All other tests pass.
