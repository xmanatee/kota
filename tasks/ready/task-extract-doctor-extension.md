---
id: task-extract-doctor-extension
title: Move doctor-cli.ts into a dedicated doctor extension
status: ready
priority: p3
area: architecture
summary: doctor-cli.ts (369 lines) contributes one CLI command (kota doctor) but lives as a standalone core file imported directly by cli.ts. Following the established pattern of moving operator CLI commands into their owning extensions would shrink core and put doctor alongside its check logic as a cohesive unit.
created_at: 2026-04-09T07:21:47Z
updated_at: 2026-04-09T07:40:09Z
---

## Problem

`src/doctor-cli.ts` registers `kota doctor` health checks and is imported directly by `src/cli.ts`. Every other operator CLI surface (approvals, audit, agents, skills, tasks, extensions, scheduler) has been migrated into its owning extension directory. The doctor command is the one significant CLI surface still living as a standalone core file.

## Desired Outcome

A new `src/extensions/doctor/` extension that:

- Owns `doctor-cli.ts` logic, moved to `src/extensions/doctor/index.ts` or `src/extensions/doctor/cli.ts`
- Registers the `kota doctor` command via `ctx.registerCliCommands()`
- Is listed in `builtinExtensions` in `src/extensions/index.ts`

`src/doctor-cli.ts` is removed and `src/cli.ts` no longer imports from it directly.

## Constraints

- No change to `kota doctor` output, check behavior, or exit codes.
- The extension may import from core (config, extension-loader, etc.) as needed — this is not a strict isolation boundary change, just a layout migration.
- `src/extensions/AGENTS.md` Built-in Extensions list is updated with the new entry.
- `src/AGENTS.md` Key Modules is updated to remove the old entry.

## Done When

- `src/extensions/doctor/` exists and the `kota doctor` command works identically.
- `src/doctor-cli.ts` is removed.
- `src/cli.ts` no longer imports from doctor-cli.ts.
- All existing doctor tests pass (or are co-located with the new extension).
- All other tests pass.
