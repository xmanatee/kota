---
id: task-make-bare-kota-launch-the-full-daemon-backed-cli-c
title: Make bare kota launch the full daemon backed CLI client
status: backlog
priority: p1
area: client
summary: Turn the current CLI navigator into the default daemon-backed KOTA client launched by bare `kota`, with parity navigation for scopes, automations, agents, modules, setup, pending owner requests, approvals, stores, and live runs.
depends_on: [task-add-shared-ui-contribution-protocol-across-clients]
created_at: 2026-06-03T13:40:30.000Z
updated_at: 2026-06-03T13:41:17.000Z
---

## Problem

Bare `kota` currently enters the prompt/REPL path, while the daemon-backed
navigator lives behind `kota navigate`. The navigator is useful but shallow:
it is a simple terminal menu over selected `KotaClient` namespaces and does
not yet feel like the default KOTA client. The owner explicitly called the
current CLI poor and wants bare `kota` to show the full CLI client with
navigation, menus, pending owner requests, automations, agents, modules, setup,
running/scheduled work, and extension/customization support.

The existing blocked rich-rendering task covers terminal rendering quality, but
the remaining gap is product architecture: the CLI should consume the same
daemon UI/action contract as the other clients.

## Desired Outcome

Make bare `kota` launch the full daemon-backed CLI client by default. The CLI
must be a thin client over `KotaClient` and the shared UI contribution
protocol, not a local runtime or `.kota` file parser.

The default CLI should support:

- Scope selection and global/directory scope navigation.
- Automations/hooks/workflows: definitions, schedules, running/pending/blocked
  runs, batch buffers, and trigger actions.
- Agents, modules, channels, stores, setup/auth requirements, approvals, owner
  questions, tasks, memory, knowledge, history, attention, digest, and
  notifications where the daemon exposes them.
- Live updates through the daemon event stream.
- Keyboard navigation, command palette or equivalent quick actions, and
  configurable keybindings/theme where practical.
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
- Evidence must be a full transcript, not only tests.

## Done When

- Running bare `kota` starts the full CLI client when attached to a TTY.
- Existing prompt/REPL behavior is available through an explicit command and
  documented in help output.
- The CLI renders shared UI contribution surfaces for setup, pending requests,
  automations/workflows, agents/modules, scopes, and live runs.
- Keyboard navigation, selection, refresh, and action execution are covered by
  deterministic tests or transcript fixtures.
- Non-TTY and JSON/scripted command behavior remains stable.
- CLI `AGENTS.md` and help text describe the new default client contract.

## Source / Intent

Owner request from `data/inbox/many.md`: "Redo the current CLI: it currently
looks poor and lazy... CLI should be implemented as default client built into
kota... when i run kota it should show this CLI. it should support everything."

Current related task: `data/tasks/blocked/task-introduce-a-rich-cli-rendering-abstraction-for-all.md`
has already landed most rendering-module and migration work and remains
blocked only on peer-CLI capture. This task must not duplicate that rendering
task; it uses the rendering layer and shared UI protocol to make the CLI the
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
  modules, setup, owner questions, approvals, and live runs.
- Transcript or test output proving non-TTY/scripted commands still work.
- Unit/integration test output for CLI routing, shared UI rendering, and
  action execution.
