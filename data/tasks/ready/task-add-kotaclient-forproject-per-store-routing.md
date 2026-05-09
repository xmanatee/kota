---
id: task-add-kotaclient-forproject-per-store-routing
title: Add KotaClient forProject per-store routing
status: ready
priority: p1
area: architecture
summary: Add a single project-scoped KotaClient primitive and thread projectId through every per-store daemon route and local namespace handler so clients and channels can route store commands without falling back to the daemon default project.
created_at: 2026-05-09T00:11:48.000Z
updated_at: 2026-05-09T00:11:48.000Z
---

## Problem

Multi-project daemon routing is real for control-plane routes, workflow
runtime events, and project-aware operator clients, but per-store routes and
client namespaces still resolve through the daemon's default project:

- `/api/knowledge`
- `/api/memory`
- `/api/history`
- `/api/tasks`
- `/recall`
- `/answer`
- `/capture`
- `/retract`

The Telegram projectId task exposed this as a channel-level blocker: a
per-message project selection cannot safely drive `/knowledge`, `/memory`,
`/history`, `/tasks`, `/recall`, `/answer`, `/capture`, or `/retract` until
the store namespaces themselves accept an explicit project scope.

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

## Done When

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
- Queue validation passes with the Telegram follow-up still blocked on this
  task's `task-done` precondition.

## Source / Intent

This resolves the architectural blocker found while preparing
`task-thread-projectid-through-telegram-channel-commands`. Splitting this
primitive out keeps the Telegram channel task focused on chat binding,
`/project`, session keying, and outbound labels, while the store-routing
contract lands once in the client and route layers that every channel can
reuse.
