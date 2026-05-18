---
id: task-add-typed-task-dependency-edges-to-the-queue
title: Add typed task dependency edges to the queue
status: ready
priority: p2
area: modules
summary: Model hard task dependencies explicitly in task metadata and teach queue validation, blocked promotion, and builder selection to honor them, so dependency-chain work can be scheduled without relying on prose heuristics.
created_at: 2026-05-18T06:05:57Z
updated_at: 2026-05-18T06:05:57Z
---

## Problem

KOTA can express a blocked task waiting on one `task-done` precondition, and
the builder has a lightweight prereq-awareness scan for prose references, but
there is still no typed dependency edge in the normalized task model. When work
is naturally sequenced across several tasks, the queue depends on owner prose,
directory placement, or a heuristic scan of blocked / doing summaries.

That is enough for occasional manual ordering, but it is weak for autonomous
queue shaping. Explorer, backlog-promoter, blocked-promoter, builder, reports,
and future multi-worker clients all need one machine-readable answer to
"which tasks must finish before this one can run?" Without it, KOTA cannot
represent dependency-chain work without either overscoping one task or keeping
implicit order in task bodies.

## Desired Outcome

Normalized tasks can declare hard predecessor task ids through one typed
queue-owned field or section. Queue validation rejects malformed dependency
graphs, and every queue-selection path treats tasks with unfinished hard
dependencies as not actionable until their predecessors are done.

Operators can inspect why a task is waiting, autonomy can select a dependency-
clear task without re-reading prose, and completed predecessors unblock their
dependents through the same repo-task state machinery that already moves tasks
between `blocked/`, `backlog/`, and `ready/`.

## Constraints

- Keep this in the repo-tasks / autonomy workflow surfaces; do not add a
  separate Kanban board, UI-only scheduler, or parallel task store.
- Pick one canonical representation for hard dependencies. Do not keep a
  frontmatter field and a second prose-only dependency format that can drift.
- Preserve the existing blocked-precondition vocabulary for non-task blockers
  (`operator-capture`, `capability-installed`, `owner-decision`). If
  `task-done` remains as a blocked-state precondition, its relationship to the
  new dependency representation must be explicit and mechanically validated.
- Reject self-dependencies, missing task ids, duplicate ids, and dependency
  cycles. Internal malformed dependency data should fail loudly.
- Builder should not need to infer hard ordering from task prose once the
  dependency edge exists.
- Do not introduce a full DAG workflow scheduler or per-task worktree fan-out
  in this slice. This task is about the task queue contract and selection
  behavior.

## Done When

- The normalized task schema has one typed way to declare hard predecessor task
  ids, with parser and validator coverage.
- Queue validation fails for malformed dependency declarations, missing
  predecessor ids, duplicate ids, self-dependencies, and cycles.
- A task with unfinished hard dependencies is not counted as actionable by
  dispatcher / backlog-promoter / builder selection. The surfaced reason names
  the unfinished predecessor ids.
- When all hard dependencies are in `done/`, the dependent task becomes
  eligible through the existing queue movement path rather than a special-case
  scheduler.
- The builder prereq-awareness path consumes the typed dependency result and no
  longer relies on prose heuristics for tasks that declare hard dependencies.
- Operator-facing task list / report output exposes waiting-on-task reasons
  without requiring a user to open every task body.

## Source / Intent

Explorer run `2026-05-18T06-03-55-034Z-explorer-b7roda` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add typed task dependency edges to the queue" --state ready --area modules --priority p2 --summary "Model hard task dependencies explicitly in task metadata and teach queue validation, blocked promotion, and builder selection to honor them, so dependency-chain work can be scheduled without relying on prose heuristics."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://github.com/cline/cline` now presents Cline as one shared coding
  agent engine across CLI, SDK, IDE extensions, scheduled agents, channels, and
  a Kanban task board where cards can carry dependency chains. Most of that
  maps to existing KOTA primitives, but dependency-chain task ordering is a
  local queue-contract gap rather than a new agent or client primitive.
- `https://github.com/continuedev/continue` still reinforces repo-resident
  agent checks as source-controlled markdown, but KOTA already covers that
  pattern through scoped `AGENTS.md`, eval-harness fixtures, and PR reviewer
  workflows; it did not justify a separate task.

Local inspection found:

- `task-builder-task-prereq-check` intentionally shipped a heuristic scan and
  explicitly left structural dependency modeling to a future task if validated.
- `src/modules/repo-tasks/blocked-precondition.ts` supports exactly one
  blocked-state `task-done` precondition, which is not enough to describe
  multi-step dependency chains across ready/backlog/blocked tasks.
- Dispatcher and backlog-promoter already distinguish actionable work from
  non-actionable queue state, so this task has a natural place to plug in
  without adding a parallel scheduler.

## Initiative

Queue contract clarity: task ordering should be discoverable from typed task
data, not reconstructed from prose, local memory, or UI-specific boards.

## Acceptance Evidence

- Focused repo-tasks validation tests proving valid dependency edges pass and
  malformed / cyclic / missing / self-referential edges fail.
- Autonomy workflow tests showing dispatcher, backlog-promoter, and builder do
  not treat a dependency-blocked task as actionable, then do treat it as
  actionable after its predecessors move to `done/`.
- A CLI or report transcript showing a waiting task with its predecessor ids
  surfaced in operator output.
