---
status: done
---

# Rich daemon CLI dashboard output

## Problem

`kota daemon` currently writes plain `[kota-daemon] ...` log lines to stderr. The output reads like raw logs rather than a purposeful operator interface. There is no at-a-glance view of what the daemon is doing, which workflows are running, queue depth, or system health.

## Desired Outcome

Running `kota daemon` in a terminal presents a rich, continuously-updated dashboard that shows:
- Daemon status and uptime
- Active and recently completed workflows with progress/outcome
- Queue depth and next scheduled work
- Key health metrics (error rate, latency, resource usage)

The output should feel like a polished CLI tool (think `htop`, `k9s`, `lazygit`) rather than a log stream. The existing structured log (NDJSON) and text log modes should remain available for piping and non-interactive contexts.

## Constraints

- The dashboard is the default interactive mode; `--log-format json` and `--log-format text` keep existing behavior for scripts and log aggregators.
- Use a proven terminal UI library (e.g. Ink, blessed, terminal-kit) rather than hand-rolling escape sequences.
- Must gracefully degrade in non-TTY contexts (pipes, CI) by falling back to plain text.
- Keep the daemon logger contract (`DaemonLogger`) stable; the dashboard consumes log events, it does not replace the logger API.

## Done When

- `kota daemon` in an interactive terminal shows a live-updating dashboard with daemon state, active workflows, and recent activity.
- Non-TTY invocations fall back to the current text or JSON log output.
- No regression in existing log-format modes.
