---
id: task-add-kotaclient-forproject-per-store-routing
title: Add KotaClient forProject per-store routing
status: done
priority: p1
area: architecture
anchor: true
summary: Track the sequenced per-store work needed before KotaClient.forProject(projectId) can honestly route knowledge, memory, history, tasks, recall, answer, capture, and retract without daemon-default leakage.
created_at: 2026-05-09T00:11:48.000Z
updated_at: 2026-05-14T00:28:01.000Z
---

## Problem

Multi-project daemon routing exists for control-plane routes, workflow runtime
events, and project-aware operator clients, but per-store routes and client
namespaces still resolve through the daemon's default project:

- `/api/knowledge`
- `/api/memory`
- `/api/history`
- `/api/tasks`
- `/recall`
- `/answer`
- `/capture`
- `/retract`

The Telegram projectId task exposed this as a channel-level blocker: a
per-message project selection cannot safely drive store commands until the
store namespaces themselves accept an explicit project scope.

## Desired Outcome

There is one public project-scoping primitive for daemon clients:
`KotaClient.forProject(projectId)`. Every per-store namespace and daemon route
uses that primitive or the equivalent typed request context so callers can
target a project explicitly without introducing a second project-selection
model.

## Initiative

Multi-project operator supervision: complete the client/store half of the
project-scoping contract so every operator surface and channel can target a
project through one daemon-owned project registry and one KotaClient routing
primitive.

## Constraints

- Reuse the existing project registry and client project selector surface.
- Do not add nullable internal `projectId` fields. A request is either scoped
  to one project or rejected at the boundary with a typed error.
- Do not introduce per-store fallback behavior that silently uses the active
  daemon project when a multi-project caller supplied an unknown or missing
  project.
- Keep local single-project calls unchanged at the command surface; the
  default project is only a boundary resolution, not an internal optional
  protocol.
- Keep store/provider ownership inside the owning modules. Do not rebind store
  singletons from Telegram or another channel.

## Decomposition Decision

Builder run `2026-05-09T00-16-06-989Z-builder-35kfvt` correctly found that a
single-push implementation would be too large to land honestly: only `tasks`
is project-scoped today, while knowledge, memory, history, recall, answer,
capture, and retract are backed by module-global providers keyed off the
daemon's single `ctx.cwd`.

The owner-decision blocker was retired on 2026-05-12. The least risky path is
to decompose by store/pipeline ownership, then land the public
`KotaClient.forProject(projectId)` contract only after the stores it routes to
are actually project-scoped.

## Sub-Slices

- `task-project-scope-knowledge-store-for-kotaclient-forproject`
- `task-project-scope-memory-store-for-kotaclient-forproject`
- `task-project-scope-history-store-for-kotaclient-forproject`
- `task-project-scope-recall-answer-capture-retract-pipelines`
- `task-land-kotaclient-forproject-route-and-client-contract`

## Done When

- The sub-slice tasks above are complete.
- `KotaClient.forProject(projectId)` exists and returns a project-scoped client
  whose per-store namespaces route through the selected project.
- Daemon route handlers for knowledge, memory, history, tasks, recall, answer,
  capture, and retract accept and validate `?projectId=` using the same
  project resolution path as the control-plane routes.
- Local namespace handlers have an explicit project-scoped execution path, not
  direct singleton-provider fallbacks for multi-project requests.
- Unknown project ids fail loudly with a typed client error.
- Single-project usage remains terse at the CLI/client boundary and does not
  require operators to pass a project id.
- A focused two-project integration test proves that per-store reads and writes
  do not cross projects through `KotaClient.forProject(id)`.
- The relevant module `AGENTS.md` files describe the project-scoped store
  routing boundary without duplicating route inventories.

## Acceptance Evidence

- Focused two-project integration evidence shows knowledge, memory, history,
  tasks, recall, answer, capture, and retract calls through
  `KotaClient.forProject(projectA)` cannot read from or write to project B,
  and vice versa.
- Route-level tests cover valid `?projectId=`, unknown `?projectId=`, missing
  project selection on a multi-project daemon, and unchanged single-project
  client calls.
- Namespace-level tests cover daemon-backed and local client paths so the
  project scope is not only present in HTTP route tests.
- Queue validation passes, and the Telegram follow-up's descendant completion
  path is satisfied.

## Source / Intent

This resolves the architectural blocker found while preparing
`task-thread-projectid-through-telegram-channel-commands`. Splitting this
primitive out keeps the Telegram channel task focused on chat binding,
`/project`, session keying, and outbound labels, while the store-routing
contract lands once in the client and route layers that every channel can
reuse.
