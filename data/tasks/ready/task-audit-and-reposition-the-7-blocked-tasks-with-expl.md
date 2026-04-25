---
id: task-audit-and-reposition-the-7-blocked-tasks-with-expl
title: Audit and reposition the 7 blocked tasks with explicit unblock preconditions
status: ready
priority: p2
area: autonomy
summary: Walk data/tasks/blocked/, verify each block is still real, reposition or drop stale ones, and leave each remaining blocked task with a typed, machine-checkable unblock precondition so future autonomy cycles can auto-promote when the precondition fires rather than waiting on human re-review.
created_at: 2026-04-25T02:49:46.570Z
updated_at: 2026-04-25T02:49:46.570Z
---

## Problem

`data/tasks/blocked/` currently holds 7 tasks, several of them aged
weeks. The blocks are recorded as free prose in `## Blocker` or
scattered "remaining operator steps" sections, so no autonomy
workflow can tell whether a block still applies or whether its
precondition has been satisfied:

- `task-capture-an-end-to-end-coding-task-parity-artifact-` — blocked
  on operator-facilitated live harness-parity capture.
- `task-enable-autonomous-access-to-auth-walled-sources-so` — blocked
  on the operator installing Playwright + provisioning an
  authenticated X storage state.
- `task-introduce-a-rich-cli-rendering-abstraction-for-all` — blocked
  on a peer-CLI side-by-side screenshot capture on operator hardware
  (phase 2 migration landed).
- `task-publish-kota-telegram-production-deploy-artifact` — p3 ops.
- `task-read-openai-swe-bench-verified-retirement-post-whe` — blocked
  on `openai.com/index/*` being fetchable (effectively the same
  enabler as the auth-walled-sources task).
- `task-review-inaccessible-research-resources-when-access` — also
  blocked on the auth-walled-sources enabler.
- `task-surface-project-selection-in-operator-clients-for-` — blocked
  on the owner picking Variant A / B / Hybrid; asked 2026-04-18, timed
  out.

Two consequences the autonomy loop cannot currently route around:

1. When an enabler lands (for example the auth-walled-sources
   mechanism shipped its code in the 2026-04-22 build; only operator
   install remains), nothing promotes the dependent tasks. They stay
   in `blocked/` until a human re-reviews by hand.
2. Nothing surfaces "this block has been valid for more than N days
   with no motion" so operator-resolvable items (the Variant pick,
   the peer-CLI captures, the Playwright install) don't escalate on
   their own cadence.

The `askOwnerSteps` recipe landed 0254fe74 / 55072f5a / 06a3588d and
a restart-safe `await-event` primitive exists, so an autonomous
workflow can now legitimately re-ask the owner the Variant question
or the "install Playwright?" question when the block is genuinely
stale. The infrastructure is there; what is missing is a typed
vocabulary of blockers that the autonomy loop can observe.

## Desired Outcome

Every task in `data/tasks/blocked/` carries a structured, typed
unblock precondition in its frontmatter or in a dedicated `## Unblock
Precondition` body section with fixed-key syntax. The precondition
vocabulary is small and enumerated — the same validator that polices
task frontmatter rejects malformed or unknown kinds. Autonomy workflows
(dispatcher or a dedicated promoter) read the preconditions, check them
cheaply against repo state, and auto-promote any blocked task whose
precondition is now satisfied — typically back to `backlog/`, or
`ready/` when the task-level priority justifies it.

Stale blocks are resolved honestly in the same pass: a block that no
longer applies moves to `backlog/`, `ready/`, or `dropped/` with an
explicit updated status; a block that applies but has sat unattended
for more than two weeks is surfaced through the existing
`attention-digest` workflow so the operator sees the backlog instead
of silently absorbing it.

## Constraints

- Typed precondition vocabulary lives in code (a TypeScript union
  + parser), not a parallel YAML schema. Reuse the existing task
  frontmatter / body parsing path; do not add a second task file
  format.
- Vocabulary starts small and extends only on demonstrated need. First
  pass covers the kinds the current 7 tasks actually use:
  - `task-done` — referenced task id must sit in `data/tasks/done/`.
  - `capability-installed` — a named capability probe must succeed
    (e.g. `playwright`, `storageState:<path>`); probes are deterministic
    and read repo state only, no network.
  - `owner-decision` — a named decision slot must be resolved; the
    autonomy loop can re-ask through the `askOwnerSteps` recipe on a
    cadence (budgeted, restart-safe).
  - `operator-capture` — a named operator-facilitated artifact must
    exist under `.kota/runs/` or a checked evidence path; purely
    operator-gated, no auto-promotion possible, but the attention-
    digest can still surface aging.
  Reject anything not in this set at frontmatter load time.
- Auto-promotion policy is conservative and idempotent. A blocked
  task whose precondition fires moves to `backlog/` by default; it
  only moves to `ready/` when the task's existing priority is `p0`
  or `p1`. The promoter never touches terminal states (`done/`,
  `dropped/`) and never acts on a dirty worktree.
- Re-asking the owner via `askOwnerSteps` for `owner-decision`
  preconditions must honor a minimum cadence (14 days after the last
  ask) to avoid spamming the queue, and must budget 10 minutes per
  ask as the recipe already does. `expired` / `timeout` outcomes
  leave the task blocked with a fresh `last_asked_at` timestamp, not
  a `blocked`/`unblocked` flip.
- Do not introduce a parallel registry for blocker kinds. Document the
  vocabulary at `data/tasks/AGENTS.md` and keep the parser + autonomy
  consumer close to the existing task-queue code.
- Do not over-generalize. Only the three tasks on the auth-walled
  enabler share a real dependency today; the `blocked_by` pattern
  should fall out of the `task-done` kind rather than being its own
  separate field.
- No backwards-compatibility dual path. Once the precondition
  vocabulary lands, blocked tasks without a valid precondition fail
  the existing task-files test; the same pass that ships the validator
  also annotates the current 7 tasks.

## Done When

- A typed precondition parser ships (TypeScript union, exhaustive
  parsing, unit tests for each kind and for rejected malformed input).
- `data/tasks/AGENTS.md` documents the precondition vocabulary and the
  auto-promotion rule at the conventions level, without enumerating
  implementation detail.
- The existing `src/task-files.test.ts` (or its moved owner) enforces
  that every task in `blocked/` declares one typed precondition, and
  rejects unknown kinds.
- All 7 current blocked tasks are annotated with a precondition; any
  that turn out to be stale on review are repositioned or dropped
  instead, with an honest status update in the same diff.
- An autonomy surface (dispatcher extension or a small sibling
  workflow like `blocked-promoter`) checks preconditions on each cycle
  and moves matching tasks to `backlog/` or `ready/` per the priority
  rule. Auto-promotion is covered by a workflow-level test that
  exercises the four precondition kinds.
- `attention-digest` surfaces blocked tasks older than 14 days in its
  output so aging operator-gated blocks do not disappear silently.
- A run artifact under `.kota/runs/<run-id>/` shows at least one real
  blocked task whose precondition was satisfied and that the autonomy
  loop promoted end-to-end (can be a synthetic fixture if no real
  block fires during the shipping run).

## Source / Intent

Run evidence over the past two weeks shows the blocked queue growing
without a structured re-review mechanism. The auth-walled-sources
enabler shipped its code on 2026-04-22 but its three dependent tasks
stayed blocked; the owner-decision for the multi-project variant
timed out on 2026-04-18 and nothing re-asked once the
`askOwnerSteps` recipe landed on 2026-04-25. Both are avoidable
regressions that are structural, not individual oversights.

This task preserves the load-bearing observation: blocked-task
hygiene today relies on human memory, which scales worse than the
autonomy loop scales, and the `askOwnerSteps` infrastructure that
just landed is specifically the tool that can close the
owner-decision loop without re-asking on every cycle.

## Initiative

Recoverable operator loop — autonomous workflows should observe
blocked-task preconditions in typed code, re-ask the owner through
`askOwnerSteps` on a budgeted cadence when the block is an owner
decision, and auto-promote blocked tasks when non-owner preconditions
fire, so blocked-queue aging becomes a visible signal rather than
absorbed waste.

## Acceptance Evidence

- The diff of `data/tasks/AGENTS.md`, the precondition-parser source,
  the blocked-task annotations, and the auto-promotion workflow or
  dispatcher extension.
- Unit test output (or fixture transcript) showing each of the four
  precondition kinds parsing and enforcing correctly.
- `src/task-files.test.ts` output after the change proving every
  blocked task carries a valid precondition.
- A `.kota/runs/<run-id>/` artifact or a workflow-level test transcript
  that exercises auto-promotion end-to-end — at minimum demonstrating
  that a `task-done` precondition whose referent is in `done/` moves
  the blocked task out on the next cycle.
- A fresh `attention-digest` run artifact where an aged blocked task
  (older than 14 days) appears in the digest output.
