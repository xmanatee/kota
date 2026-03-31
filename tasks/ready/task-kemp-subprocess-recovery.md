---
id: task-kemp-subprocess-recovery
title: Add subprocess health monitoring and restart for KEMP foreign extensions
status: ready
priority: p3
area: runtime
summary: If a KEMP foreign extension subprocess crashes or becomes unresponsive mid-session, KOTA has no recovery path beyond a full daemon restart. Adding a health check and restart mechanism would let KOTA self-heal without operator intervention.
created_at: 2026-03-31T04:25:00Z
updated_at: 2026-03-31T12:22:00Z
---

## Problem

KEMP foreign extensions run as subprocesses managed by `ForeignExtensionStdio`.
If a subprocess crashes (non-zero exit), the transport marks itself `closed` and
all subsequent tool invocations fail with `"Transport closed"`. There is no automatic
restart, no health check, and no notification to the operator. The only recovery is
a full daemon restart.

For extensions implementing long-lived tools or network-connected subprocesses, a
crash is not rare — and a silent failure requiring full daemon restart is a poor
operator experience.

## Desired Outcome

- When a KEMP subprocess exits unexpectedly, `ForeignExtensionStdio` detects the
  exit and attempts to respawn the subprocess up to a configurable `maxRestarts`
  (default: 3) with exponential backoff starting at 2 seconds.
- A `log` message is emitted to KOTA's stderr for each restart attempt.
- If all restarts are exhausted, the extension is marked failed and a bus event
  `extension.failed` is emitted so extensions (e.g. Telegram, webhook) can
  notify the operator.
- A ping/pong mechanism (`{"type":"ping"}` / `{"type":"pong"}`) lets KOTA
  detect a hung (non-crashed) subprocess. If a `pong` is not received within
  `pingTimeoutMs` (default: 5 seconds), the subprocess is killed and the restart
  logic activates.
- Foreign extensions that do not implement ping silently time out and restart —
  backward compatible.

## Constraints

- Default behavior (no ping, no restart on exit) is preserved if the extension
  config sets `maxRestarts: 0`.
- The restart state must not leak to the tool registry — in-flight `invoke`
  calls during a restart should return an error result, not hang.
- KEMP protocol docs (`docs/FOREIGN-EXTENSIONS.md`) updated with ping/pong spec.
- No changes to the HTTP transport shape or the stdio protocol envelope — ping/pong
  is an optional extension to the existing protocol, not a breaking change.

## Done When

- A crashed KEMP subprocess is automatically restarted up to `maxRestarts` times.
- Hung subprocess detection via ping/pong works for extensions that support it.
- Restart attempts are logged to stderr.
- Bus event `extension.failed` is emitted when all restarts are exhausted.
- `docs/FOREIGN-EXTENSIONS.md` documents ping/pong as an optional health check.
- Unit tests cover: crash restart, max restarts exhausted, ping timeout.
