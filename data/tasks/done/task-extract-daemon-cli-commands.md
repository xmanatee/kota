---
id: task-extract-daemon-cli-commands
title: Move daemon-facing CLI commands (events, session, status) into the daemon module
status: done
priority: p2
area: architecture
summary: events-cli.ts, session-cli.ts, and status-cli.ts are standalone core files that each implement one daemon interaction command (kota events tail, kota session list, kota status). All three query the DaemonControlClient and have no business in core; they belong in src/modules/daemon-ops/.
created_at: 2026-04-09T07:40:09Z
updated_at: 2026-04-09T08:14:19Z
---

## Problem

Three core CLI files remain as standalone top-level files under `src/`:

- `src/events-cli.ts` (71 lines) — `kota events tail` streams daemon event bus
- `src/session-cli.ts` (146 lines) — `kota session list` shows active daemon sessions
- `src/status-cli.ts` (117 lines) — `kota status` shows daemon/queue/budget snapshot

All three import `DaemonControlClient` and are logically owned by the daemon subsystem. The `src/modules/daemon-ops/` module already owns `kota daemon` subcommands. Consolidating here finishes the daemon CLI surface.

`src/cli.ts` currently imports `registerEventsCommands`, `registerSessionCommands`, and `registerStatusCommand` directly. These should become part of the daemon module's `ctx.registerCliCommands()` contribution.

## Desired Outcome

- `src/modules/daemon-ops/events-cli.ts`, `session-cli.ts`, and `status-cli.ts` (or merged into `daemon/cli.ts`)
- Registered via `ctx.registerCliCommands()` in the daemon module
- `src/events-cli.ts`, `src/session-cli.ts`, `src/status-cli.ts` removed
- `src/cli.ts` no longer imports the three removed functions
- `src/AGENTS.md` Key Modules entries removed; `src/modules/AGENTS.md` daemon entry updated

## Constraints

- No change to command names, flags, output format, or exit codes.
- `status-cli.ts` imports `getApprovalQueue` from the approval-queue module — this import is fine inside a daemon module file.
- Keep tests co-located with the module if any exist; delete test stubs if none do.

## Done When

- `kota events tail`, `kota session list`, and `kota status` work identically after the move.
- The three source files are removed from `src/`.
- All tests pass.
