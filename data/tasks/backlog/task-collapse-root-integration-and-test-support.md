---
id: task-collapse-root-integration-and-test-support
title: Collapse root integration and obsolete test support
status: backlog
priority: p1
area: integration-architecture
summary: Retain only distinct real composition journeys and remove overlapping built, source, local, daemon, numbered-suite, fake-runtime, reset, catalog, migration, and compatibility support.
task_class: Platform
depends_on: [task-remove-module-lifecycle-test-duplication, task-prune-data-capability-adapter-tests, task-prune-operator-and-channel-test-duplication, task-simplify-workflow-and-autonomy-tests, task-redesign-mcp-test-ownership, task-prune-deterministic-eval-harness-tests]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Root integration and cross-module suites frequently cover the same behavior through built CLI, source CLI, local client, daemon client, route, or mocked integration paths. Numbered part files, shared fake runtimes, global resets, copied catalogs, migration fixtures, and legacy aliases preserve implementation complexity after owners have moved.

## Desired Outcome

A small integration portfolio covers only boundaries where separately correct owners can still compose incorrectly. Packaging, process, protocol, persistence, and operator journeys are selected by distinct failure, and obsolete test-support infrastructure and production compatibility paths are deleted.

## Constraints

- Do not delete a journey until its behavior owner and distinct composition risk are recorded.
- Prefer real boundaries for the few retained journeys; an integration label with internal module mocks does not justify retention.
- Remove numbered suite splits when they only divide one repeated fixture family.
- Delete test-only reset APIs and ambient singleton setup by simplifying production ownership, not by adding more cleanup hooks.
- Remove current-architecture migration tests and compatibility aliases once supported migration is complete.

## How We Will Know

- Every root integration journey identifies the composition defect it can catch beyond owner checks.
- Built and source, local and daemon, and route and CLI variants are not exhaustive mirrors without distinct packaging or process risk.
- Obsolete helpers, fixtures, snapshots, fake runtimes, numbered parts, resets, aliases, and legacy branches disappear with their consumers.
- Root and support LOC falls materially within the non-additive 20k-25k opportunity band and the repository becomes simpler to navigate.
