---
id: task-fix-daemon-cli-status-banner-layout-collisions-and
title: Fix daemon CLI status banner layout collisions and polish terminal presentation
status: done
priority: p2
area: cli
summary: Daemon CLI banner still shows collision bugs (e.g. $1930.84Defs), inconsistent indentation between sections, and mixes status summary with streaming log; research how peer CLIs present daemon state and tighten the KOTA presentation.
created_at: 2026-04-19T19:40:19.661Z
updated_at: 2026-04-19T23:26:28.353Z
---

## Problem

After the previous CLI redesign work (`task-rich-daemon-cli-dashboard-output`,
`task-redesign-daemon-cli-status-output-for-clarity-and-`), the daemon CLI
output still has visible presentation problems both in interactive mode and
in `kota daemon` logs. Concrete issues captured from a recent run:

- Cost and label collision: the stats block renders `Cost       $1930.84Defs`
  because the cost value runs into the next label without padding. This is
  a layout regression that the redesign task was supposed to fix.
- Two nested framed sections render at startup — a short bordered status
  banner immediately followed by a second indented framed block (`Scheduler
  poll`, `Workflows`, `Pending schedules`) — that visually duplicate each
  other and break alignment.
- The static status banner and the streaming log are not visually distinct
  in practice. Log lines appear indented inside what looks like a frame,
  making it hard to read where status ends and activity begins.
- The output does not have a clear information hierarchy: important state
  (pending queue, last run, paused, cost) competes with low-signal
  scheduler chatter on equal visual weight.

The inbox capture also asks for a broader evaluation: research how peer
CLIs (Claude Code, Codex CLI, gemini-cli, pi-mono's terminal UI, and
comparable tools like `k9s`, `lazygit`, `htop`) present daemon state,
live activity, and interactive controls, and pick a presentation model
that is clean, efficient, and extensible across interactive and
daemon-log modes.

## Desired Outcome

- The startup output renders a single cohesive status section (no nested
  frames), with clear column alignment and no value/label collisions at
  any realistic cost, count, or width.
- Status and streaming activity are visually separated: a reader can tell
  at a glance what is current state and what is ongoing log flow.
- Information hierarchy favors what the operator actually needs: daemon
  health, pending queue, recent outcomes, pause state. Scheduler poll
  interval and low-signal counters are either demoted or removed from the
  default view.
- A short written comparison captures what peer CLIs do well and where
  KOTA's presentation should and should not follow them, so future CLI
  work has a coherent reference.
- The chosen approach remains compatible with `--log-format json` /
  `--log-format text`, non-TTY degradation, and the `DaemonLogger`
  contract.

## Constraints

- Follow existing CLI module boundaries — layout belongs in the CLI
  presentation module, not in daemon core.
- Do not reintroduce raw UUIDs or full ISO timestamps in the default view.
- Do not build a custom terminal framework when a proven library already
  fits (Ink, blessed, terminal-kit were the previously considered set).
- Non-TTY contexts must still produce clean, greppable output.
- Keep the comparison narrow and decision-focused; do not add an external
  link catalog or a long research dump to durable docs.

## Done When

- The daemon CLI banner renders without value/label collisions or nested
  framed sections in a standard 80-column terminal and in wider windows.
- Status and streaming log are visibly distinct without requiring the
  reader to parse frames.
- A concise comparison of peer CLI presentation exists in the relevant
  CLI `AGENTS.md` scope and informs the chosen layout and any follow-ups.
- No regression in `--log-format json` / `--log-format text` output or in
  non-TTY fallback.
