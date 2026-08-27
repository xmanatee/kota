---
id: task-prune-recall-answer-read-adapters
title: Consolidate recall, answer, and read adapters
status: backlog
priority: p1
area: data-capabilities
summary: Remove duplicated validation, resolution, propagation, result-arm, and rendering behavior from read-oriented capability surfaces.
task_class: Platform
depends_on: [task-generate-daemon-client-transport-bindings, task-centralize-semantic-index-lifecycle]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `src/modules/recall`, `answer`, relevant document/read providers, routes, local/daemon clients, CLI/tool consumers, citations, semantic-unavailable handling, fixtures, and tests.

## Required Changes

- Name one owner for query validation, source resolution, semantic availability, citation/provenance, not-found, and answer assembly.
- Use generated routine transport and direct domain result types.
- Retain adapters only for meaningful query transforms, provider mapping, wire decoding, or rendering.
- Delete forwarding wrappers, copied result unions, local/daemon parity matrices, provider resets, and lifecycle fixtures.

## Must Not Complete While

Any behavior or file is unclassified, any surface repeats the domain result matrix, or test code is displaced into support data.

## Done When

The inventory has zero unresolved rows and retained surface scenarios each name a failure not caught at the domain owner.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
