---
id: task-remove-module-lifecycle-test-duplication
title: Remove module lifecycle and metadata test duplication
status: backlog
priority: p1
area: module-runtime
summary: Make module registration, metadata, setup, capability, effect, route, client, workflow, and lifecycle conformance structural, then delete per-module catalog and source-shape tests.
task_class: Platform
depends_on: [task-align-verification-ownership-and-cadences, task-generate-daemon-client-transport-bindings]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Module suites repeatedly assert registration enabled or disabled, metadata literals, setup requirements, client contribution presence, route catalogs, effects, lifecycle resets, and source absence. These assertions freeze implementation fixtures and duplicate facts already declared in module definitions, schemas, generators, and loader behavior.

## Desired Outcome

The module definition schema, loader, registry, generated client graph, and host admission collectively make valid contributions true by construction. Shared conformance observes only cross-cutting behavior once, while a module tests only additional behavior or capabilities it explicitly declares.

## Constraints

- Keep canonical declarative values inspectable at their source instead of copying catalogs into assertions.
- A shared checker may validate declared capability contracts; it must not require every implementation to expose every optional operation.
- Remove migration-era exports, compatibility aliases, duplicate local or daemon registration branches, test-only reset APIs, and source-absence scans when the new owner lands.
- Do not replace hundreds of small tests with one enormous reflective snapshot.

## How We Will Know

- Invalid module declarations fail at schema, loader, generator, or host admission boundaries.
- Routine modules no longer need tests that restate their names, literal metadata, wiring, or absence of old source.
- Capability-specific modules run only the conformance contracts they declare plus their semantic exceptions.
- Large module test families and numbered part files are removed or reduced to distinct public behavior.
