---
id: task-unify-client-resource-state-and-search-shells
title: Unify client resource state and search shells
status: backlog
priority: p1
area: clients
summary: Replace per-resource loading, result, error, offline, retry, empty, and semantic-unavailable implementations with shared production state and UI shells.
task_class: Product
depends_on: [task-align-verification-ownership-and-cadences]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Mobile and other clients repeat async resource reducers, search actions, offline banners, retry flows, empty-query rules, empty states, semantic-unavailable handling, and screen setup across knowledge, memory, history, tasks, recall, answer, digest, attention, capture, and retract. Test repetition mirrors production repetition.

## Desired Outcome

One typed async-resource state machine and shared search or resource shells own common transitions and rendering. Resource screens declare domain-specific data, labels, actions, and exceptions; they do not each reimplement the lifecycle.

## Constraints

- Preserve platform-native accessibility, navigation, cancellation, offline, retry, and error behavior.
- Use composition and typed variants instead of a configuration object with many unrelated optional flags.
- Do not solve this with test-only parameterization while leaving repeated production reducers and screens.
- Delete per-screen lifecycle fixtures and tests when the shared owner makes them redundant; retain distinct domain rendering and actions.

## How We Will Know

- The generic state owner demonstrates idle, loading, success, empty, recoverable failure, offline, retry, cancellation, and semantic-unavailable transitions once.
- Each resource screen suite covers only domain-specific behavior and genuine platform exceptions.
- Adding a comparable resource does not require copying a reducer and the same screen test matrix.
- Client test LOC falls materially within the investigation's non-additive 8k-12k opportunity band while owner-visible behavior remains credible.
