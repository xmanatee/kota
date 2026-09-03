---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences, task-generate-daemon-client-transport-bindings]
---

# Make module lifecycle conformance structural

## Scope / Starting Points

Inventory `src/core/modules`, `src/core/modules/testing`, every module definition and scoped module suite for registration enabled/disabled, metadata literals, setup requirements, client/route contributions, effects, workflow contributions, lifecycle/reset behavior, catalogs, source absence, and numbered part files.

## Required Changes

- Make `ModuleDefinition`, schema validation, loader admission, generated clients, and host lifecycle the sole structural owners.
- Add shared conformance only for cross-cutting guarantees selected from capabilities declared by the module.
- Keep canonical declarative values inspectable at source instead of copying literals into assertions.
- Delete per-module wiring/catalog/presence/source-shape tests, migration exports, compatibility aliases, duplicate local/daemon branches, reset APIs, and numbered fixture families after ownership moves.
- Retain module suites only for semantic behavior or declared capability exceptions.

## Must Not Complete While

Any module/test family is unclassified, any checker requires undeclared optional behavior, any structural fact is copied into a literal snapshot, or any compatibility/reset path remains without a current consumer.

## Done When

The module/capability/file inventory has zero unresolved rows; invalid declarations fail at schema/loader/generator/host admission; routine modules have no tests restating names, metadata, wiring, or absence of old source.

## Acceptance Evidence

Provide the module/capability/disposition matrix, invalid-declaration observations, and before/after production, executable-test, and authored-support LOC.

## Initiative

Lean behavioral verification: test only contracts a module declares and behavior it adds.
