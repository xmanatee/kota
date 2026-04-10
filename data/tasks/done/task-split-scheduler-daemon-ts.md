---
id: task-split-scheduler-daemon-ts
title: Split scheduler/daemon.ts — extract subscription lifecycle into daemon-subscriptions.ts
status: done
priority: p2
area: refactor
summary: scheduler/daemon.ts is 296 lines, at the 300-line limit. The subscription setup/teardown block in Daemon.start() and Daemon.stop() (8 separate stop-handle fields, ~80 lines) forms a natural cohesive unit that can move to daemon-subscriptions.ts, making Daemon.start/stop cleaner.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/core/daemon/daemon.ts` is 296 lines — at the file size limit. The `Daemon` class carries 8 stop-handle fields and manages their setup/teardown inline in `start()` and `stop()`. This subscription lifecycle is a cohesive unit separate from the daemon's orchestration logic.

## Desired Outcome

Extract the subscription setup and teardown into `src/core/daemon/daemon-subscriptions.ts`. This module should expose a function that subscribes all listeners and returns a single `unsubscribe()` function, replacing the 8 individual stop-handle fields in `Daemon`. The `Daemon` class retains orchestration, state management, and the public API.

## Constraints

- Public API of `Daemon` must not change.
- All existing tests must continue to pass.
- `daemon.ts` must end up measurably under 300 lines.

## Done When

- `src/core/daemon/daemon-subscriptions.ts` exists with the extracted subscription logic.
- `src/core/daemon/daemon.ts` is measurably reduced (under 230 lines preferred).
- All tests pass.
- `scheduler/AGENTS.md` is updated if it lists key modules.
