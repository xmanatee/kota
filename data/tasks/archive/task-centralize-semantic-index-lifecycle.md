---
status: done
---

# Centralize semantic index lifecycle

## Scope / Starting Points

Inventory `src/modules/semantic-index` and the `memory-semantic`, `knowledge-semantic`, `history-semantic`, and `tasks-semantic` stores, including ranking, staleness, reindex, deletion, error, cache, and reset behavior.

## Required Changes

- Move common lifecycle and ranking algorithms into `SemanticIndexManager` and its narrow ports.
- Make each semantic store declare supported mutation, deletion, reindex, and search capabilities.
- Retain only entry mapping, persistence identity, and semantic exceptions in store adapters.
- Delete wrapper lifecycle copies, redundant sidecar/cache state, reset hooks, and repeated manager matrices.

## Must Not Complete While

Any lifecycle behavior has two production owners, any store is tested for an undeclared capability, or any inventory row is unresolved.

## Done When

The manager owns every common transition once and store suites cover only declared capabilities and mapping exceptions.

## Acceptance Evidence

Provide the lifecycle/capability/disposition matrix and before/after production, test, and support LOC.

## Initiative

Child of `task-consolidate-task-collections-and-indexing`.
