---
id: task-surface-project-selection-in-operator-clients-for-
title: Surface project selection in operator clients for multi-project supervision
status: blocked
priority: p2
area: architecture
summary: Once the daemon can manage multiple project roots, native/web/CLI clients need a first-class project selector and per-project view so operators can supervise more than one repo at a time
created_at: 2026-04-18T00:40:56.393Z
updated_at: 2026-04-18T02:44:19.138Z
---

## Problem

The in-progress `task-enable-kota-to-operate-on-external-projects` work is making the daemon project-aware: `DaemonConfig.projectDir` is honored across the workflow runtime, run store, and agent step `cwd`, and the new `resolveProjectDir()` helper gives every operator surface one consistent answer for "which project is this daemon pointing at". But clients today are still implicitly single-project: the CLI daemon mode, the daemon-backed web chat, the macOS menu-bar app, and the mobile client all assume one repo per daemon. The moment a real operator runs KOTA against a second project — the stated goal of that doing task — there is no way for a client to list known projects, switch between them, or show sessions scoped to one. This will become a visible gap the first time the daemon is pointed at an external target.

## Desired Outcome

- The daemon control API exposes the current project and a way to list/select other projects the operator has registered with this daemon.
- Operator clients (CLI daemon mode, web, macOS, mobile) can show the active project, list sessions grouped by project, and switch between projects without restarting the daemon.
- Cross-project views (active runs, owner questions, approval queue) render per-project rather than as a flat mixed list, so the operator can supervise one project at a time.

## Constraints

- Keep multi-project state in the daemon, not duplicated in each client. Clients query the daemon; they do not read `.kota/` files directly.
- Use the existing control-API and event-subscription patterns; do not add a second side channel just for project switching.
- Do not block on external-project work being fully done; a first pass can land as soon as the daemon reliably runs one project-aware session end-to-end.
- Keep the project-selector surface small and consistent across clients. No per-client bespoke model for "which project is active".
- Respect existing module boundaries: daemon-ops owns the control surface, not individual clients.

## Done When

- The daemon control API has typed endpoints and events for listing configured projects, reporting the active project, and switching projects.
- At least the CLI daemon mode and the web client render project-scoped views and expose a project selector; macOS and mobile clients have an open follow-up if they lag.
- A session, run, or owner question is always attributable to one project in the API output, not ambiguous across projects.
- Tests cover the project-switch control path and the per-project filtering of sessions/runs.
- Docs in the relevant client and daemon-ops `AGENTS.md` describe the model at the conventions level, not as a catalog of endpoints.

## Blocker

This task is blocked until the multi-project runtime shape is decided and the
work is decomposed.

The daemon today is strictly single-project: `Daemon.projectDir` is consumed
once at construction by scheduler, task-store, run-store, module-log-store,
workflow runtime, notification gate, and every control-API endpoint. Two
materially different architectures both satisfy the current wording:

1. **Daemon hosts many project runtimes in parallel.** Every daemon-owned
   subsystem becomes per-project; every bus event, session, run, and owner
   question carries a `projectId`; control-API calls and SSE subscriptions
   accept a project scope. Large core reshape, highest long-term capability.
2. **One daemon per project plus a client-side registry that multiplexes
   across daemons.** No core reshape; clients read a shared registry and
   connect to the target project's daemon socket. Satisfies
   "switch without restarting *a* daemon" only if "restart" means OS process
   restart of the client-selected daemon.

The current constraint "keep multi-project state in the daemon, not duplicated
in each client" pushes toward variant 1 or a hybrid where the daemon owns a
project registry file but only runs one project runtime and swaps it on
switch.

The owner was asked on 2026-04-18 to pick between these; the question timed
out. The work also spans two full client surfaces (CLI daemon mode + web) and
per-project attribution of session / run / owner-question outputs, which is
more than a single builder run should carry at once.

Unblock by:

1. Owner picks the runtime architecture.
2. Task is split into at least three follow-ups: (a) daemon-side project
   identity + registry + typed control-API endpoints + per-project attribution
   in existing API outputs; (b) CLI daemon-mode project selector and
   project-scoped views; (c) web client project selector and project-scoped
   views.

