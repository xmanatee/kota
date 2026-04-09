---
id: task-split-daemon-handle-ts
title: Extract DaemonControlHandle factory from daemon.ts into daemon-handle.ts
status: done
priority: p2
area: architecture
summary: The Daemon constructor in scheduler/daemon.ts has grown to 645 lines with a ~275-line inline DaemonControlHandle object literal that bridges the Daemon class to DaemonControlServer. Extracting this factory into a dedicated daemon-handle.ts module shrinks daemon.ts back within limits and gives the control bridge a clear home.
created_at: 2026-04-09T01:06:21Z
updated_at: 2026-04-09T01:06:21Z
---

## Problem

`src/scheduler/daemon.ts` has grown from ~300 lines (when it was last split) to 645 lines. The primary culprit is the inline `DaemonControlHandle` object literal passed to `new DaemonControlServer(...)` in the `Daemon` constructor — this anonymous bridge spans approximately lines 121–397 and mixes workflow state projections, run-store data mapping, metric aggregation, and task status reads all in one deeply nested constructor call.

The file violates the 300-line limit by 115%, making it hard to navigate and extend. Each new daemon API endpoint adds more code into this already large constructor, continuing the growth.

## Desired Outcome

A new `src/scheduler/daemon-handle.ts` module exports a `buildDaemonHandle(daemon: Daemon): DaemonControlHandle` factory function. The `Daemon` constructor calls this factory rather than constructing the handle inline. `daemon.ts` returns to under 300 lines. No behavior changes.

## Constraints

- Public API of `Daemon` must not change.
- `DaemonControlHandle` interface must not change.
- All existing tests must continue to pass.
- The factory may receive whatever `Daemon` internals it needs via a typed context parameter rather than tight coupling to `Daemon` internals — or it may be a method on `Daemon` that returns the handle. Either is acceptable as long as the result is a clear module boundary.
- File lengths: `daemon.ts` must end measurably below 350 lines; `daemon-handle.ts` may be as long as needed to hold the full bridge.

## Done When

- `src/scheduler/daemon-handle.ts` exists with the extracted handle factory.
- `src/scheduler/daemon.ts` is under 350 lines.
- All existing daemon tests pass without modification.
- `src/scheduler/AGENTS.md` lists the new module.
