---
id: task-expose-session-autonomy-mode-in-operator-clients
title: Expose session autonomy mode in operator clients
status: ready
priority: p1
area: guardrails
summary: Let operators list and change the per-session autonomy mode (passive/supervised/autonomous) from the daemon-ops CLI, web client, and native clients so the newly landed core axis is usable end-to-end
created_at: 2026-04-18T04:01:38.065Z
updated_at: 2026-04-18T04:01:38.065Z
---

## Problem

Commit `9081709d` added a session-level autonomy mode (`passive` /
`supervised` / `autonomous`) at the core session/tool-runner boundary, and
every session now carries an explicit `autonomyMode` from creation. But no
operator surface exposes or adjusts it. `kota serve` and the autonomous
workflow path bake `"autonomous"` in at session construction, the
daemon-control session listing does not report the mode, and no
daemon-ops, web, or native client can switch a running session's mode.
The new core axis is therefore invisible and unreachable outside code —
operators cannot actually run a passive or supervised session against a
repo without editing source.

## Desired Outcome

- The daemon control API reports `autonomyMode` on every listed session
  and exposes a typed endpoint to change the mode of a running session.
- The `kota session` / daemon-ops CLI lists sessions with their current
  mode and has a subcommand to switch a session between the three modes.
- The daemon-backed web client and the macOS and mobile clients render
  each session's mode and offer a mode picker on session creation and
  for a running session.
- `kota serve` and the autonomy workflow runtime accept an explicit
  autonomy mode at session start instead of unconditionally opening with
  `"autonomous"`; the default for new interactive sessions comes from
  a documented config knob, not a hardcoded value.

## Constraints

- Keep the mode axis orthogonal to per-tool risk classification. Do not
  reuse or extend the approval-queue approval endpoints to change a
  session's mode — mode changes and tool approvals are different events.
- Strict typed protocol. No nullable `autonomyMode`, no silent fallback
  to autonomous anywhere beyond the single documented default knob.
- Keep multi-client state in the daemon. Each client queries the
  control API; no client reads session state from `.kota/` files.
- Do not surface mode change events to agent prompts. Mode is an
  operator control; the agent only sees the effective tool gating.
- Daemon-ops owns the CLI surface and daemon-control-* typed endpoint
  wiring; individual clients own their own mode-picker UI.
- A running session switched from `autonomous` to `supervised` should
  apply the new mode to the next tool call, not tear the session down.

## Done When

- `DaemonControl` session listing and session-detail responses include
  `autonomyMode`; a new typed endpoint sets the mode of a running
  session and is covered by a daemon-control test.
- The daemon-ops session CLI lists modes per session and has a
  subcommand that changes the mode via the daemon control API.
- Web, macOS, and mobile clients display the mode on every session card
  and allow the operator to set the mode on session creation and change
  it on a running session.
- `kota serve` reads a documented config default for the interactive
  session's initial autonomy mode instead of inheriting the compile-time
  `"autonomous"` constant, and that default is exercised by a test.
- Integration test covers switching a running session from
  `autonomous` to `supervised` mid-run and proves the next non-safe tool
  call is queued rather than executed.
- `AGENTS.md` entries for session, approval-queue, and daemon-ops are
  updated once to describe the operator surface at the conventions
  level without duplicating the protocol contract.
