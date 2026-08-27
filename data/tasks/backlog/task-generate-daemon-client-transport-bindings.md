---
id: task-generate-daemon-client-transport-bindings
title: Generate routine daemon client transport bindings
status: backlog
priority: p1
area: daemon-contracts
summary: Extend the canonical operation graph so routine daemon requests, decoders, namespace assembly, and freshness are generated instead of handwritten and repeatedly tested.
task_class: Platform
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Many modules independently declare local clients, daemon clients, route mappings, request DTOs, scope threading, decoders, and namespace assembly. Thousands of test lines only prove that these handwritten copies agree, while production drift remains representable.

## Desired Outcome

Module-owned operation descriptors are the canonical source for routine transport bindings and aggregate client assembly. Generation makes path, method, body, query, response decoder, capability, and scope rules consistent by construction; handwritten code remains only where an adapter adds semantic transformation or security-sensitive behavior.

## Constraints

- Extend the existing contract graph rather than introduce a parallel descriptor language or second client registry.
- Normalize routine wire DTOs at domain boundaries so client-only reshaping is exceptional and explicit.
- Generate deterministic output and provide one freshness observation without freezing generated catalogs in ordinary tests.
- Delete superseded handwritten wiring, compatibility exports, missing-registration branches, and routine daemon-client tests in the same slices.
- Retain focused proof for authored semantic transforms, authentication, redaction, retries, streaming, or protocol limits.

## How We Will Know

- Adding a routine module operation changes one canonical descriptor and regenerated output, not route, daemon-client, aggregate, and catalog implementations by hand.
- Representative generated requests interoperate with the daemon and stale generated output is detected once.
- Routine transport mapping tests and source-absence tests are gone, while exceptional adapter behavior remains owned.
- The change removes an estimated 7k-10k test LOC plus duplicated production wiring without shifting it into snapshots.
