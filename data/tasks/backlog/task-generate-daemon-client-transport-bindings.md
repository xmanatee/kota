---
id: task-generate-daemon-client-transport-bindings
title: Generate routine daemon client transport bindings
status: backlog
priority: p1
area: daemon-contracts
summary: Make module operation descriptors the single source for routine routes, requests, decoders, daemon clients, and namespace assembly.
task_class: Platform
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `src/core/modules/module-definition.ts`, module loader/client assembly, daemon transport, every module `client.ts`, `routes.ts`, `*-operations.ts`, `index.ts` `daemonClient(link)` contribution, aggregate client namespace, and associated mapping tests.

Classify every operation as routine mapping or an exception requiring authored authentication, redaction, retry, streaming, protocol-limit, or semantic-transform behavior.

## Required Changes

- Add one module-owned operation descriptor authority for method, path, scope, capability, request mapping, response decoder, and client namespace.
- Generate routine route/client binding and aggregate namespace assembly from that authority with deterministic output and one freshness observation.
- Normalize routine wire DTOs at domain boundaries; keep authored adapters only for classified exceptions.
- Migrate every routine operation in the inventory and delete its handwritten factory, route mapping, missing-registration branch, compatibility export, and duplicated mapping/source-absence tests.
- Do not introduce a second registry beside module definition/loader ownership or freeze generated catalogs in snapshots.

## Must Not Complete While

Any operation is unclassified, any routine operation still needs edits in multiple transport layers, any generated output can be stale undetected, or deleted mapping checks have moved into snapshots.

## Done When

- The inventory has zero unresolved operations.
- Adding a representative routine operation changes one canonical descriptor and regenerated output only.
- A representative generated request interoperates with the daemon.
- Every remaining handwritten binding names its exceptional semantic or security responsibility.

## Acceptance Evidence

Provide the operation/classification/disposition matrix, generated-freshness observation, representative interoperability evidence, and before/after production, executable-test, and authored-support LOC.

## Initiative

Lean behavioral verification: make routine transport consistency true by construction.
