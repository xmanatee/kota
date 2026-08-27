---
id: task-lean-behavioral-verification-program
title: Make KOTA verification lean and behavior-owned
status: backlog
priority: p1
area: architecture
summary: Track the architecture-led program that removes duplicated behavioral representations and reduces maintained executable test LOC by at least 70 percent without weakening protocol, security, durability, recovery, or operator confidence.
task_class: Platform
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

KOTA has about 1,356 executable test files and 338,516 test LOC because the same contract is often implemented and asserted at the domain, route, transport, client, CLI or channel, and integration layers. Repeated production state machines, handwritten transport wiring, broad default cadences, and automation instructions that turn proof preferences into test obligations keep recreating the concentration.

## Desired Outcome

KOTA has one production owner and one strongest proportionate proof for each behavior. Routine conformance is true by construction, adapters test only behavior they add, specialized risks run at truthful cadences, and maintained executable test LOC falls by at least 70 percent from a freshly frozen inclusive baseline.

## Constraints

- Preserve distinct protocol, security, durability, recovery, destructive-action, and owner-visible behavior.
- Delete superseded production duplication and tests together; do not hide test code in helpers, fixtures, snapshots, generated input, or eval data.
- Treat the LOC target as a temporary migration outcome, not a permanent quality quota or autonomous trigger.
- Do not retain compatibility aliases, shadow implementations, or migration-only paths after their supported transition is complete.
- Keep this anchor non-dispatchable in backlog and update it as slices complete or become obsolete.

## How We Will Know

- Every tracked slice is done or explicitly removed as obsolete with its ownership decision recorded.
- Inclusive executable test LOC is at most 30 percent of the frozen baseline, with authored test-support accounting preventing displacement.
- Representative retained behavior, protocol, security, durability, and recovery guarantees still have credible owners and observations.
- Production glue, ambient mutable state, compatibility branches, and repeated abstraction implementations decrease with the suite.

## Source / Intent

Non-additive opportunity bands from the investigation: module ownership and adapters 75k-100k LOC; workflow and autonomy 35k-45k; root integration and support 20k-25k; approval and decision flows 12k-18k; eval harness 12k-14k; MCP 10k-14k; client state and screens 8k-12k; task collections and semantic wrappers 8k-15k; generated daemon transport 7k-10k.

Tracked stages:

- [ ] task-repair-run-state-scope-schema-migration

- [ ] task-migrate-historical-run-metadata-safely

- [ ] task-make-task-authoring-atomic-and-complete

- [ ] task-align-verification-ownership-and-cadences

- [ ] task-generate-daemon-client-transport-bindings

- [ ] task-consolidate-task-collections-and-indexing

- [ ] task-unify-client-resource-state-and-search-shells

- [ ] task-centralize-approval-and-owner-decision-state

- [ ] task-remove-module-lifecycle-test-duplication

- [ ] task-prune-data-capability-adapter-tests

- [ ] task-prune-operator-and-channel-test-duplication

- [ ] task-simplify-workflow-and-autonomy-tests

- [ ] task-redesign-mcp-test-ownership

- [ ] task-prune-deterministic-eval-harness-tests

- [ ] task-collapse-root-integration-and-test-support

- [ ] task-prove-seventy-percent-test-loc-reduction
