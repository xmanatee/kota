---
id: task-thread-projectid-through-telegram-channel-commands
title: Thread projectId through Telegram channel commands and session routing
status: ready
priority: p2
area: architecture
summary: Make telegram-status and telegram-interactive channels project-aware so operators on a multi-project daemon can target a specific project per message rather than the daemon's default
created_at: 2026-05-08T20:28:46.713Z
updated_at: 2026-05-14T00:28:01.000Z
---

## Problem

The multi-project daemon foundation is in place: per-project runtime
bundles, projectId on every event-bus payload, projectId on every
control-API route, project-scoped CLI/web/native client selectors, and a
two-project isolation integration test. But the Telegram module
(`src/modules/telegram/`) carries zero `projectId` references. When a
multi-project daemon hosts the `telegram-status` and `telegram-interactive`
channels, every inbound `/status`, `/digest`, `/recall`, `/answer`,
`/capture*`, `/retract*`, per-store search command, plus every interactive
session message, resolves against whatever the daemon picks as default —
not against an operator-chosen project. Outbound notifications carry no
project label either.

This is the gap named in the parent anchor's "Channel-to-project
attachment" section: "Multi-project transports (e.g. Telegram bot, webhook
channel) resolve the target project per-message from typed identity
metadata rather than assuming one project per daemon."

## Desired Outcome

Both Telegram channels are explicit about project scope:

- `telegram-status` commands route per-message to a project. The chat-to-
  project binding is typed and lives in module config (one chat ↔ one
  project by default) with a per-chat override mechanism (e.g. an explicit
  `/project <id>` chat command) that updates only the daemon-owned per-
  chat selection. Resolution is loud: an unrecognised project id, or a
  chat with no binding on a multi-project daemon, replies with a clear
  message rather than silently using "the active project".
- `telegram-interactive` sessions are bound to a project at session
  creation. The per-chat session map keys on `(chatId, projectId)`, not
  just `chatId`. Switching project ends the current session and starts a
  new one against the new project's runtime bundle.
- Outbound notifications (workflow events, attention digests, owner-
  question escalations) include the project label in the rendered text
  when the daemon hosts more than one project. Single-project setups stay
  one-line per the existing presence threshold.
- Per-store commands (`/knowledge`, `/memory`, `/history`, `/tasks`,
  `/recall`, `/answer`, `/capture*`, `/retract*`) consume the
  per-message resolved projectId through the existing `KotaClient`
  namespace surface (`?projectId=` parameter on the daemon route).

## Constraints

- No nullable `projectId?` on internal protocol types. A Telegram message
  resolves to exactly one project; "no project" is a typed error reply,
  not a silent default.
- No second project-selection model. Reuse the existing
  `client.projects.list()` / `client.projects.use(id | null)` surface
  consumed by `daemon-ops` rather than introducing a per-channel registry.
- Single-project setups must not regress. The presence threshold ("more
  than one project hosted") gates project labels in outbound text and
  the `/project` command; KOTA-on-itself stays one-line.
- The interactive session loop already accepts a project-scoped runtime
  bundle. Use that boundary; do not rebind stores from inside the channel.
- Keep the chat allowlist semantics intact. The chat allowlist is
  orthogonal to project routing.

## Done When

- `src/modules/telegram/index.ts` and the per-channel handlers
  (`status-poll.ts`, `bot.ts`, `callback-poll.ts`, `owner-question-reply.ts`)
  resolve a `projectId` for every inbound message and every outbound emit.
- A new `/project` command lists hosted projects and lets the operator
  switch the per-chat selection. Default chat-to-project bindings live in
  typed module config; an unbound chat on a multi-project daemon refuses to
  proceed with a clear message.
- Interactive sessions are keyed on `(chatId, projectId)`. Switching
  projects ends the current session cleanly; the next message starts a new
  session against the new project's runtime.
- Outbound notification renderers attach a project label when the daemon
  hosts more than one project; single-project daemons render unchanged.
- A focused integration test boots one daemon with two projects, drives
  Telegram-shaped inbound messages from a single chat against both
  projects, and asserts: per-store search hits never cross projects;
  capture/retract dispatch into the correct project's runtime; outbound
  events carry the right project label; an unbound chat on the multi-
  project daemon fails loudly.
- `src/modules/telegram/AGENTS.md` describes the chat-to-project binding
  model and the `/project` command at the conventions level.

## Source / Intent

Closes the "Channel-to-project attachment" gap named in the now-completed
strategic anchor `task-surface-project-selection-in-operator-clients-for-`
(Variant A — daemon hosts many project runtimes). The anchor and its
sub-slices delivered the daemon-side primitive, every store/event/route,
the CLI/web/native client selectors, and the two-project integration
test. The Telegram channel was explicitly named as a multi-project
transport in the anchor's Proposal section but is not yet rewired.
Today the daemon would route every Telegram message against its default
project, which silently violates the multi-project supervision invariant
once an operator registers a second project.

This is the next concrete step in the same initiative; doing it as a
single substantive task keeps the channel boundary changes coherent
rather than splitting them across several mechanical PRs.

## Initiative

Multi-project operator supervision: extends the daemon-side foundation
into the Telegram external transport so multi-project supervision works
end-to-end through an interactive channel, not just through CLI/web/
native clients. Sibling channels (slack, email, webhook, github-webhook)
follow as their own tasks if and when their notification or inbound
shape needs the same threading.

## Acceptance Evidence

- A new focused integration test in `src/modules/telegram/` boots one
  daemon with two projects and asserts per-message routing,
  per-`(chatId, projectId)` session keying, outbound project labels, and
  an unbound-chat failure path; passes against the multi-project daemon
  fixture.
- The unit-test suite for `telegram-status` commands continues to pass,
  with the new `/project` command tested under both single-project (no
  project label rendered) and multi-project (label rendered) shapes.
- `src/modules/telegram/AGENTS.md` updated to describe the chat-to-
  project binding and the `/project` command at the conventions level —
  no enumerated catalog of state.

## Scope Resolution

Builder run `2026-05-08T20-31-17-184Z-builder-00uj92` discovered that the
constraint "Per-store commands consume the per-message resolved projectId
through the existing `KotaClient` namespace surface (`?projectId=`
parameter on the daemon route)" is not currently realizable: only
control-plane routes (`/status`, `/sessions`) honor `?projectId=` today.
Per-store routes (`/api/knowledge`, `/api/memory`, `/api/history`,
`/api/tasks`, `/recall`, `/answer`, `/capture`, `/retract`) and their
KotaClient namespace daemon/local handlers do not. Local handlers use
singleton providers (`getKnowledgeProvider()` etc.), so the integration
test's "per-store search hits never cross projects" assertion requires
threading projectId through every store's route + namespace handlers and
introducing a `KotaClient.forProject(id)` mechanism — a substantial
architectural slice spanning roughly ten modules.

The owner-question timeout is resolved by the repository's own architecture
rules: split the per-store routing primitive into a preceding architectural
task sequence, then let Telegram consume that single client/route contract.
The concrete enabler is
`task-land-kotaclient-forproject-route-and-client-contract`; the broader
anchor is `task-add-kotaclient-forproject-per-store-routing`.

That enabler has now landed. This task is ready to consume the shared
project-scoped KotaClient and per-store route contract rather than landing a
parallel channel-local project routing model or narrowing away the store
isolation invariant.
