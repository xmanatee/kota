---
id: task-foreign-extension-auto-restart
title: Auto-restart crashed foreign extensions with backoff
status: done
priority: p2
area: reliability
summary: Foreign stdio extensions that crash cause tool calls to fail permanently until the daemon is restarted. Automatic restart with exponential backoff would recover from transient crashes without operator intervention.
created_at: 2026-04-01T09:44:18Z
updated_at: 2026-04-01T10:00:00Z
---

## Problem

Foreign extensions running as stdio subprocesses (`src/foreign-extension-stdio.ts`) are spawned once at daemon startup. If the subprocess exits unexpectedly — due to a crash, OOM, or a code error — the extension silently enters a dead state. Subsequent tool calls to that extension fail with a broken pipe or similar error. The daemon logs the exit but makes no attempt to recover.

Operators must notice the failure and restart the daemon to restore the extension. In production environments this is a manual interruption that may go unnoticed for long periods.

## Desired Outcome

When a foreign stdio extension subprocess exits unexpectedly, the extension loader:

1. Detects the exit (non-zero code or signal).
2. Waits an initial delay (e.g., 1 second), then respawns the subprocess.
3. Applies exponential backoff (cap at ~60 seconds) if successive restarts fail quickly.
4. After a configurable maximum number of attempts (default 5), marks the extension as permanently failed and stops retrying.
5. Emits a bus event on each restart attempt and on permanent failure, so notification extensions can alert operators.

In-flight tool calls that fail due to a crash receive a retryable error so the workflow step can apply its own retry policy.

## Constraints

- Restart logic is owned by `src/foreign-extension-stdio.ts` or a thin supervisor wrapper; do not spread it into the extension loader or daemon core.
- HTTP foreign extensions (`src/foreign-extension-http.ts`) already benefit from the tool-retry layer and do not need subprocess restart logic.
- Backoff parameters (initial delay, max attempts) are configurable via the extension definition in `kota.config.json`.
- Permanent failure state must be observable via `kota extension list` and the web UI extensions panel.

## Done When

- A crashed stdio foreign extension is automatically restarted with exponential backoff.
- Restart attempt count and last-error are visible in `kota extension list`.
- Permanent failure (max attempts reached) emits a bus event and is reflected in extension status.
- Existing foreign-extension-stdio tests pass; add tests for restart-on-crash and max-attempt cap.
