---
id: task-replace-readline-navigator-with-a-real-daemon-back
title: Replace readline navigator with a real daemon-backed TUI client
status: ready
priority: p1
area: client
summary: Turn bare kota / kota navigate into the full daemon-backed terminal client promised by the completed CLI task, with real TUI state, live run supervision, actions, and transcript evidence.
created_at: 2026-07-06T15:16:35.431Z
updated_at: 2026-07-06T15:23:04.183Z
task_class: Product
---

## Problem

The completed task `task-make-bare-kota-launch-the-full-daemon-backed-cli-c`
claims the default CLI should be a full daemon-backed CLI/TUI client, but the
current implementation is still a readline command loop over rendered shared
surfaces. It has useful plumbing, but not the product promised by the task:
no real full-screen interaction model, no persistent panes, no first-class live
run supervision view, no direct action affordances, and no operator-grade
pause/resume/abort workflow from the client itself.

This mismatch caused owner confusion on 2026-07-07: running `pnpm dev daemon`
looked like the main control surface, while the actual shared UI client is
hidden behind bare `kota` / `kota navigate` and still feels shallow.

## Desired Outcome

Bare `kota` on a TTY and explicit `kota navigate` open a real daemon-backed
terminal client, not a readline menu. The client must make the daemon,
workflow queue, active runs, pending owner requests, approvals, setup gaps,
tasks, modules, agents, stores, and live events inspectable and controllable
through the shared UI/action protocol.

The run supervision view must let an operator see active/pending/recent runs,
follow logs or step output, pause/resume dispatch, abort active runs, cancel
queued runs, retry/replay/resume failed runs where supported, and see exactly
why an action is unavailable.

When no daemon is running, the client must show an offline state and expose a
clear start action or exact command path instead of rendering empty or
misleading controls.

## Constraints

- Stay a thin `KotaClient` consumer. Do not read `.kota/` files directly from
  the navigator or add a second daemon/runtime model.
- Use the shared UI contribution/action protocol as the source of truth for
  surfaces and actions. If the protocol lacks data for the TUI, extend that
  protocol rather than hardcoding CLI-only state.
- Preserve non-TTY/scripted behavior and explicit `kota run` prompt behavior.
- Use the existing rendering module or deliberately adopt a real terminal UI
  architecture, but do not keep expanding isolated readline prompts as the
  primary product surface.
- Secrets and setup values must never be echoed or stored in transcripts.

## Done When

- Bare `kota` and `kota navigate` launch the same full terminal client on a
  TTY.
- The first screen clearly identifies the connected daemon/project, dispatch
  state, active/pending work, inbox counts, setup gaps, and live-event status.
- Workflow controls are discoverable and executable from the client, including
  dispatch pause/resume and active-run abort.
- The active-run view supports live updates and a path to logs or step output
  without requiring the operator to remember a separate command.
- Offline daemon state is explicit and offers a start/reconnect path.
- Existing machine-readable commands, JSON outputs, `kota run`, and pipe mode
  remain stable.

## Source / Intent

Owner follow-up on 2026-07-07 after the daemon paused and the operator could
not find controls from `pnpm dev daemon`: "why can't i control or resume or see
any proper controls or monitoring from there?" Investigation showed
`src/modules/cli/navigator.ts` is still a readline loop, while
`data/tasks/done/task-make-bare-kota-launch-the-full-daemon-backed-cli-c.md`
already records the owner's requirement for a full CLI/TUI client.

## Initiative

Operator control plane: the terminal client should be a first-class daemon
client, not a thin status renderer.

## Acceptance Evidence

- Full transcript under `.kota/runs/<run-id>/transcript.txt` showing bare
  `kota` launching the client, navigating Status, Work/Runs, Inbox, Setup,
  Modules/Agents, and Stores, then executing at least one read action and one
  safe write action.
- Transcript or fixture showing dispatch pause/resume from the client against
  a running daemon.
- Transcript showing offline daemon behavior and the start/reconnect affordance.
- Focused tests for navigator state, action execution, live-event update
  handling, and non-TTY refusal/scripted command stability.
