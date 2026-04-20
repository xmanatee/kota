---
id: task-wire-three-markers-through-index
title: Wire three marker files through the marker INDEX
status: ready
priority: p2
area: eval-harness
summary: Eval-harness fixture — builder must add three marker files AND register every one of them in data/markers/INDEX.md. Every integration point must be wired; missing any one is a failure.
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-20T00:00:00.000Z
---

## Problem

Past autonomous builds have shipped partial wiring when a task lists
multiple explicit integration points in its "Done When" section. A
representative run is `2026-04-13T13-59-56-234Z-builder-gofonh`, where
the critic rejected the builder because one required integration
point (`moduleMonitoring` in `mergeConfigs`) was missing even though
the task explicitly required "full wiring through parsing, merging,
schema, docs, and tests". A wiring task is a contract: every
enumerated point must be updated, not most of them.

## Desired Outcome

- Three marker files exist under `data/markers/` — one per name listed
  in "Done When".
- `data/markers/INDEX.md` mentions each marker filename so the index
  registry stays in sync with the marker set.
- This task is moved out of `data/tasks/ready/`.

## Constraints

- Do not skip any marker or omit it from the INDEX. Missing even one
  integration point fails the fixture.
- Only touch `data/markers/` and this task's state. Do not edit
  unrelated repo files.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/alpha.txt` exists.
- `data/markers/beta.txt` exists.
- `data/markers/gamma.txt` exists.
- `data/markers/INDEX.md` contains the substring `alpha.txt`.
- `data/markers/INDEX.md` contains the substring `beta.txt`.
- `data/markers/INDEX.md` contains the substring `gamma.txt`.
- This task file is no longer under `data/tasks/ready/`.
