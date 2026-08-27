---
id: task-prune-data-capability-adapter-tests
title: Prune duplicated data capability adapters and tests
status: backlog
priority: p1
area: data-capabilities
summary: Track bounded read, semantic-store, and write-path ownership migrations across KOTA data capabilities.
task_class: Platform
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

Each data behavior has one domain or store owner; routine transport is generated; adapters retain only meaningful transforms; duplicated route, client, CLI, propagation, and result-arm implementations and tests are removed.

## Tracked Slices

- [ ] task-prune-memory-knowledge-history-task-adapters
- [ ] task-prune-recall-answer-read-adapters
- [ ] task-prune-capture-retract-write-adapters

## Done When

All three inventories have zero unresolved rows and no forwarding wrapper, duplicated result union, ambient provider reset, compatibility path, or implementation-shaped fixture remains in scope.

## Initiative

Lean behavioral verification: consolidate production ownership before pruning surface mirrors.
