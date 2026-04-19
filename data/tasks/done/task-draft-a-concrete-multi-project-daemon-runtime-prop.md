---
id: task-draft-a-concrete-multi-project-daemon-runtime-prop
title: Draft a concrete multi-project daemon runtime proposal
status: done
priority: p2
area: architecture
summary: Write a concrete architectural proposal comparing daemon-hosts-many-projects vs one-daemon-per-project-plus-client-registry with typed control-API, session, run, and event attribution shape so the owner can pick and unblock project selection in operator clients
created_at: 2026-04-18T15:49:27.283Z
updated_at: 2026-04-19T20:53:37.306Z
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
  against the current single-project daemon at the level of ownership
  boundaries, attribution policy, client/operator behavior, and
  migration risk.
- For each variant: the durable architectural consequences, how
  channels attach to a project's sessions, what class of consumers
  is affected, and which impact areas need implementation tasks.
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
- The durable guidance must live close to the code in the relevant
  `AGENTS.md` scope. Keep exact file, type, endpoint, event, and
  constant inventories out of durable prose; those belong in source
  and focused validation.
- Do not invent new terminology. Use the existing glossary
  (`agent`, `session`, `workflow`, `channel`, `module`, `store`,
  `daemon`).
- The proposal must respect existing rules: no parallel alias
  systems between core and modules, no project-local state
  duplicated into each client, no test-only production flags.
- Do not assume the owner prefers variant 1. Present both fairly.

## Done When

- A written proposal exists in the relevant `AGENTS.md` scope and
  describes both variants at the level of durable ownership and
  behavior decisions.
- For each variant the proposal identifies ownership shifts,
  attribution policy, channel-to-project attachment rules, affected
  client classes, and follow-up implementation task boundaries.
- For each variant the proposal sketches a migration path with a
  first PR that is self-contained and does not regress
  KOTA-on-itself.
- The blocked task
  `task-surface-project-selection-in-operator-clients-for-`
  either gets unblocked (owner picks, it splits into its three
  documented follow-ups) or its `Blocker` is updated to point at
  this proposal so the decision is now fully informed.
