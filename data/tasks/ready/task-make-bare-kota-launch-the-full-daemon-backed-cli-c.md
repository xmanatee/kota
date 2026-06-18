---
id: task-make-bare-kota-launch-the-full-daemon-backed-cli-c
title: Replace the shallow bare KOTA navigator with a full daemon-backed CLI client
status: ready
priority: p1
area: client
summary: Replace the current readline-style operator menu launched by bare `kota` with a modern daemon-backed CLI/TUI client that consumes the shared UI/action protocol and gives parity access to scopes, workflows, agents, modules, setup, pending owner requests, approvals, model/effort/default controls, stores, and live runs.
depends_on: [task-add-shared-ui-contribution-protocol-across-clients]
created_at: 2026-06-03T13:40:30.000Z
updated_at: 2026-06-18T23:18:26.568Z
task_class: Product
---

## Problem

Current audit update on 2026-06-18: bare `kota` no longer enters the prompt
path in a TTY. It routes to the same operator console as `kota navigate`. That
fixes the launch-routing part, but not the user-visible quality problem. The
current experience is still a shallow readline menu with five numbered
sections, static screen rendering, text prompts, and no real TUI state model,
focus management, command palette, multi-pane layout, live run view, or shared
typed controls.

The owner explicitly called the current CLI poor and wants bare `kota` to show
the full CLI client with navigation, menus, pending owner requests,
automations, agents, modules, setup, running/scheduled work, model and effort
controls, defaults, launch parameters, and extension/customization support.

The completed rich-rendering task improved terminal output primitives and
migrated many command surfaces, but it did not produce a modern interactive
CLI client. The remaining gap is product interaction architecture: the CLI
should consume the same daemon UI/action contract as the other clients.

## Desired Outcome

Replace the current bare-`kota` numbered menu with a full daemon-backed CLI/TUI
client. The CLI must be a thin client over `KotaClient` and the shared UI
contribution/action protocol, not a local runtime or `.kota` file parser.

The default CLI should support:

- Scope selection and global/directory scope navigation.
- Automations/hooks/workflows: definitions, schedules, running/pending/blocked
  runs, batch buffers, and trigger actions.
- Agents, modules, channels, stores, setup/auth requirements, approvals, owner
  questions, tasks, memory, knowledge, history, attention, digest, and
  notifications where the daemon exposes them.
- Model selection, effort, autonomy mode, launch presets/defaults, and other
  run/session parameters exposed by the shared UI/action protocol.
- A first-class run/agent execution view with current state, timeline, logs,
  approvals/questions, progress, metrics/costs where available, pause/abort or
  resume actions where allowed, errors, and final results.
- Live updates through the daemon event stream.
- Fast keyboard navigation, hotkeys, command palette or equivalent quick
  actions, predictable resize behavior, and configurable keybindings/theme
  where practical.
- Extension points driven by the shared UI contribution protocol.

## Constraints

- Depends on the shared UI contribution protocol. Do not hardcode a second
  one-off navigator model in `src/modules/cli`.
- Keep machine-readable subcommands and JSON paths intact. Bare `kota` changes
  the default human client, not scripting contracts.
- The CLI remains a client, not a module-owned runtime. It may live in the CLI
  module but must use `KotaClient`/daemon control APIs for state.
- Preserve a direct prompt/chat command under an explicit subcommand if the
  current bare behavior remains useful.
- Reuse the rendering module for terminal output and avoid raw ANSI outside
  the renderer.
- Research and choose a real terminal UI architecture before implementation.
  Viable references include Ink for TypeScript/React CLIs, Bubble Tea for Go's
  Elm-style TUI model, Textual for Python terminal/web widgets, and Ratatui for
  Rust terminal widgets. If KOTA keeps a custom TypeScript renderer, it must
  still define input, focus, update, render, resize, and testable state
  boundaries instead of adding isolated formatting helpers.
- Evidence must be a full transcript, not only tests.

## Done When

- Running bare `kota` starts the full CLI client when attached to a TTY; the
  current five-option readline menu is no longer the primary product
  experience.
- Existing prompt/REPL behavior is available through an explicit command and
  documented in help output.
- The CLI renders shared UI contribution surfaces for setup, pending requests,
  automations/workflows, agents/modules, scopes, model/effort/default
  controls, and live runs.
- Starting or supervising a code/agent run uses a stateful run view, not a
  plain stream of old-style command output.
- Keyboard navigation, selection, refresh, and action execution are covered by
  deterministic tests or transcript fixtures.
- Non-TTY and JSON/scripted command behavior remains stable.
- CLI `AGENTS.md` and help text describe the new default client contract.

## Source / Intent

Owner request from `data/inbox/many.md`: "Redo the current CLI: it currently
looks poor and lazy... CLI should be implemented as default client built into
kota... when i run kota it should show this CLI. it should support everything."

Related completed task:
`data/tasks/done/task-introduce-a-rich-cli-rendering-abstraction-for-all.md`
landed the rendering module, migrated broad command output, and captured peer
CLI comparison evidence. This task must not duplicate that rendering task; it
uses the rendering layer and shared UI/action protocol to make the CLI the
default product surface.

Relevant current code: `src/cli.ts`, `src/modules/cli/navigator.ts`,
`src/modules/cli/AGENTS.md`, `src/modules/rendering/`, and
`clients/AGENTS.md`.

## Initiative

CLI as first-class KOTA client: the default terminal experience should expose
the same daemon capabilities as web, macOS/iOS, and mobile.

## Acceptance Evidence

- Full CLI transcript under `.kota/runs/<run-id>/transcript.txt` showing bare
  `kota` launching the client, navigating at least scopes, automations,
  modules, setup, owner questions, approvals, model/effort/default controls,
  and live runs.
- Run-mode transcript or screencast artifact showing an active code/agent run
  with state, progress, logs, approvals/questions, errors, and result handling.
- Transcript or test output proving non-TTY/scripted commands still work.
- Unit/integration test output for CLI routing, shared UI rendering, and
  action execution.
