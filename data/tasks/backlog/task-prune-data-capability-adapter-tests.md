---
id: task-prune-data-capability-adapter-tests
title: Prune duplicated data capability adapter tests
status: backlog
priority: p1
area: data-capabilities
summary: Give memory, knowledge, history, tasks, recall, answer, capture, and retract one owner per behavior and remove repeated route, client, CLI, propagation, and result-arm tests.
task_class: Platform
depends_on: [task-generate-daemon-client-transport-bindings, task-consolidate-task-collections-and-indexing]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

The data-capability path often proves the same validation, resolution, propagation, not-found, semantic-unavailable, local or daemon parity, and rendering behavior at every surface. Large fixture stacks mock internal owners and lock implementation choreography even when the public result is unchanged.

## Desired Outcome

Each data behavior has a named domain or store owner. Generated transport covers routine mapping, shared collections and semantic indexing cover common algorithms, adapters cover only meaningful transforms, and a minimal vertical journey covers composition where it can fail distinctly.

## Constraints

- Inventory behavior ownership before deleting; do not infer safety from textual duplication alone.
- Prefer returned values, durable state, events, wire messages, and rendered operator outcomes over collaborator call assertions.
- Remove forwarding wrappers, duplicated result unions, ambient provider resets, compatibility paths, and implementation-shaped fixtures as ownership consolidates.
- Preserve security, provenance, retraction correctness, citation behavior, and persistence semantics.

## How We Will Know

- A behavior such as semantic-unavailable or not-found has one strongest owner observation and only distinct adapter mappings above it.
- Refactoring private helpers, constructor order, provider assembly, or call choreography does not force unrelated tests to change.
- Local and daemon paths are not both retained as exhaustive mirrors when generation or one interoperability journey proves parity.
- Deleted test/support LOC is accompanied by deletion of duplicated production glue rather than helper displacement.
