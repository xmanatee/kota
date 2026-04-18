---
id: task-draft-a-concrete-multi-project-daemon-runtime-prop
title: Draft a concrete multi-project daemon runtime proposal
status: ready
priority: p2
area: architecture
summary: Write a concrete architectural proposal comparing daemon-hosts-many-projects vs one-daemon-per-project-plus-client-registry with typed control-API, session, run, and event attribution shape so the owner can pick and unblock project selection in operator clients
created_at: 2026-04-18T15:49:27.283Z
updated_at: 2026-04-18T15:49:27.283Z
---

## Problem

`task-surface-project-selection-in-operator-clients-for-`
is blocked waiting for an owner decision between two materially
different multi-project runtime architectures:

1. **Daemon hosts many project runtimes in parallel.** Every
   daemon-owned subsystem (scheduler, task store, run store,
   module-log store, workflow runtime, notification gate, owner-
   questions, approval queue, event bus) becomes per-project; every
   session, run, event, and owner question carries a `projectId`;
   control-API calls and SSE subscriptions accept a project scope.

2. **One daemon per project plus a client-side registry that
   multiplexes across daemons.** No core reshape; clients read a
   shared registry and connect to the target project's daemon socket.

An owner question was sent on 2026-04-18 and timed out without a
pick. The blocker has remained unresolved because there is no
concrete side-by-side write-up of what each variant costs, what it
breaks, and what the migration shape looks like — only abstract
trade-off prose. The present task is to produce that concrete
proposal so the owner can pick.

## Desired Outcome

- A concrete, self-contained proposal that compares both variants
  against the current single-project daemon, at the level of typed
  control-API surface, runtime state ownership, session/run/event/
  owner-question attribution, and module-loading shape.
- For each variant: which existing files and types are touched,
  where a `projectId` has to be threaded, what happens to existing
  single-project control-API consumers, and how channels (Slack
  bot, Telegram bot, webhook, web chat, native clients) attach to
  a given project's sessions.
- For each variant: an honest migration outline — what can land in
  one PR vs. what demands a multi-PR sequence, and what breaks for
  the existing KOTA-on-itself setup during the transition.
- Enough concrete detail that the blocked operator-client task can
  be split into the decomposed follow-ups its `Blocker` section
  already sketches (a, b, c) as soon as the owner picks.

## Constraints

- This task produces analysis and a written proposal; it does not
  itself ship either architecture. Do not land runtime changes.
- Keep the proposal scoped to multi-project runtime shape. Do not
  re-open unrelated architectural choices (module loading,
  workflow validation, guardrails) in the same document.
- The proposal must live close to the code — in the relevant
  `AGENTS.md` (daemon, modules, or a new narrow proposal section in
  this task itself). Do not spawn a new top-level `docs/` RFC tree
  or a parallel governance surface.
- Do not invent new terminology. Use the existing glossary
  (`agent`, `session`, `workflow`, `channel`, `module`, `store`,
  `daemon`).
- The proposal must respect existing rules: no parallel alias
  systems between core and modules, no project-local state
  duplicated into each client, no test-only production flags.
- Do not assume the owner prefers variant 1. Present both fairly.

## Done When

- A written proposal exists in the repo (as an `AGENTS.md` section,
  a scoped doc, or an explicit followup task body) that describes
  both variants at the level of concrete type and surface changes.
- For each variant the proposal enumerates: control-API endpoints
  and events that change shape, daemon subsystems whose ownership
  shifts, per-project attribution on sessions/runs/events/owner
  questions, and channel-to-project attachment rules.
- For each variant the proposal sketches a migration path with a
  first PR that is self-contained and does not regress
  KOTA-on-itself.
- The blocked task
  `task-surface-project-selection-in-operator-clients-for-`
  either gets unblocked (owner picks, it splits into its three
  documented follow-ups) or its `Blocker` is updated to point at
  this proposal so the decision is now fully informed.
