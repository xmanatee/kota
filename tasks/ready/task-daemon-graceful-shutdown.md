---
id: task-daemon-graceful-shutdown
title: Implement graceful SIGTERM shutdown for the daemon
status: ready
priority: p3
area: reliability
summary: The daemon terminates immediately on SIGTERM, which can kill active workflow runs mid-step and leave partial run artifacts or orphaned processes. A grace period that waits for active runs before stopping would prevent data loss and improve reliability under process managers.
created_at: 2026-03-31T00:20:16Z
updated_at: 2026-03-31T01:43:23Z
---

## Problem

When the daemon receives SIGTERM (from `systemctl stop`, Docker, or `kota daemon stop`),
it exits immediately. Any workflow run that is mid-step is killed without cleanup: the
run record may be left in state `"running"`, agent processes may become orphaned, and
partial artifacts written by the step are left behind. Operators restarting the daemon
see stale "running" entries in the history panel and may experience corrupt task state.

## Desired Outcome

On SIGTERM the daemon enters a draining phase:

1. Stops accepting new workflow trigger events.
2. Waits for all active runs to reach a terminal state (completed, failed, or
   interrupted), up to a configurable grace period (default 60 s).
3. Active runs that have not finished within the grace period are marked `"interrupted"`
   with a reason of `"daemon shutdown"`.
4. The daemon then shuts down cleanly.

`kota daemon stop` sends SIGTERM (not SIGKILL) so the grace period applies.
SIGKILL still terminates immediately without waiting.

Grace period is configurable via `daemon.shutdownGracePeriodMs` in `kota.config`
(0 = drain indefinitely, omit = use 60 s default).

## Constraints

- The draining logic lives in the daemon lifecycle layer, not in individual workflow
  runners.
- No new public API surface required beyond the config key.
- The existing `kota daemon stop` CLI command is updated to use SIGTERM.
- Tests should cover: clean shutdown with no active runs, shutdown with a run that
  completes within the grace period, and shutdown that exceeds the grace period.

## Done When

- SIGTERM triggers a drain phase; active runs complete before shutdown.
- Runs that exceed the grace period are marked `"interrupted"` (not `"running"`).
- `kota daemon stop` uses SIGTERM.
- Grace period is configurable and defaults to 60 s.
- Test coverage for all three drain scenarios above.
