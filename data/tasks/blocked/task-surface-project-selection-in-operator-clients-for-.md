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

This task is blocked until the owner picks the multi-project runtime shape.

A concrete side-by-side proposal now lives at the top of
`src/core/daemon/AGENTS.md` under **Multi-Project Runtime Shape (Proposal)**.
It compares the two variants at the durable-ownership level (daemon hosts many
project runtimes vs. one daemon per project plus a client-side registry),
acknowledges the hybrid, and sketches migration first-PR shape and risk for
each. It also lists the follow-up decomposition (a/b/c) that either variant
produces. The owner was asked on 2026-04-18 and timed out; re-asking once the
proposal is in place is the remaining step.

Unblock by:

1. Owner reads the proposal in `src/core/daemon/AGENTS.md` and picks a
   variant.
2. Task splits into at least the three follow-ups already sketched in the
   proposal: (a) daemon-side project identity and attribution; (b) CLI
   daemon-mode selector and project-scoped views; (c) web client selector and
   project-scoped views. Native macOS and mobile parity land as their own
   follow-ups.

