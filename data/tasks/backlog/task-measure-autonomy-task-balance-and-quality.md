---
id: task-measure-autonomy-task-balance-and-quality
title: Measure autonomy task balance and quality
status: backlog
priority: p2
area: modules
summary: Provide a kota report or dashboard panel that answers whether autonomy is balanced (priority/area mix, explorer strategic vs fan-out share, builder breakdown, blocker classes, cost per completed task) so reviews are repeatable instead of ad hoc shell analysis.
created_at: 2026-04-28T22:04:38.177Z
updated_at: 2026-04-28T22:04:38.177Z
---

## Problem

The 2026-04-28 broad daemon review produced useful manual stats, but there is
no reusable operator report that answers whether autonomy is balanced. Each
review currently requires ad hoc shell analysis over `data/tasks/`, git
history, and `.kota/runs/`, so the same questions are recomputed by hand
every time.

## Desired Outcome

A `kota` report or dashboard panel that answers, on demand, the balance and
quality questions reviews currently ask manually:

- How much work is p0/p1/p2/p3 over time.
- How much work is architecture / runtime / modules / client / operator-ux /
  research.
- How often explorer generates strategic work vs narrow fan-out.
- How often builder lands tests, docs, client parity, or core changes.
- How many tasks are blocked by owner decision, operator capture, or missing
  capability.
- How much cost per completed task, broken down by workflow and area.

The signals come from data the repo already has — task files, git history,
and `.kota/runs/` — so the report is reproducible without a separate data
pipeline.

## Constraints

- Read from existing repo surfaces; do not introduce a new persistent stats
  store.
- Surface this as an operator-facing report or dashboard panel, not as an
  agent-facing context feed (autonomy must not receive cost signals).
- Do not duplicate per-task data into a parallel ledger; aggregate at read
  time.
- Keep the report fast enough to run on demand from the CLI.
- Prefer a single discoverable surface (one CLI subcommand or one dashboard
  panel) over scattered helper scripts.

## Done When

- A reproducible `kota` report or dashboard panel exists that answers each
  question above against current repo state.
- Output is rendered through the existing rendering layer (CLI) or dashboard
  primitives — no ad-hoc `console.log`, no parallel changelog file.
- The 2026-04-28 review's manual stats can be reproduced from the new
  surface, recorded as evidence.
- The autonomy module's scoped `AGENTS.md` references where the report
  lives.

## Source / Intent

2026-04-28 broad daemon review (verbatim): "The 2026-04-28 review produced
useful manual stats, but there is no reusable operator report that answers
whether autonomy is balanced. Questions to automate: How much work is
p0/p1/p2/p3 over time? How much work is architecture/runtime/modules/client/
operator-ux/research? How often does explorer generate strategic work vs
narrow fan-out? How often does builder land tests, docs, client parity, or
core changes? How many tasks are blocked by owner decision, operator
capture, or missing capability? How much cost per completed task, by
workflow and area? Desired outcome: A `kota` report or dashboard panel
gives these signals from task files, git history, and `.kota/runs/`, so
reviews like this are repeatable instead of ad hoc shell analysis."

## Initiative

Operator visibility into autonomy: replace ad hoc shell-driven reviews with
a single discoverable report so balance and quality regressions are seen
instead of guessed.

## Acceptance Evidence

- A CLI transcript or dashboard screenshot under `.kota/runs/` showing the
  report rendering all six question areas against the live repo on the day
  this lands.
- A side-by-side comparison with the 2026-04-28 manual stats demonstrating
  parity (or an explanatory delta).
