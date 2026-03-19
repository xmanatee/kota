---
id: task-keep-separate-process-history-files
title: Keep separate process history files
status: dropped
priority: p1
area: process
summary: Maintain repo-local changelog, audit, lesson, and archive files alongside commits and run artifacts.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

The repo had accumulated separate history and process files that duplicated git
history, run artifacts, docs, and tasks.

## Desired Outcome

History should come from commits and `.kota/runs/`, while guidance comes from
docs and `AGENTS.md` files.

## Constraints

- Keep one clear source of truth per purpose.
- Do not preserve historical process files just because they used to exist.
- Avoid reintroducing archive layers around tasks.

## Done When

- Separate process-history files are no longer part of the active workflow.
- Future work does not depend on those files.
- The remaining coordination surfaces are simpler and clearer.
