---
id: task-prune-cli-rendering-test-duplication
title: Prune CLI and rendering duplication
status: backlog
priority: p1
area: cli
summary: Keep CLI verification focused on parsing, exit status, confirmation, and owner-visible rendering rather than domain lifecycle mirrors.
task_class: Product
depends_on: [task-generate-daemon-client-transport-bindings, task-centralize-approval-lifecycle-state, task-centralize-owner-decision-lifecycle-state]
created_at: 2026-08-27T00:45:00.000Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory `src/modules/cli`, `src/modules/rendering`, command modules, source/built CLI suites, snapshots, result matrices, exit codes, confirmations, and local/daemon variants.

## Required Changes

- Centralize production rendering primitives and command-result mapping.
- Retain checks for option parsing, exit status, destructive confirmation, stable owner-visible wording, terminal behavior, and packaging failures.
- Delete copied domain result matrices, full-output snapshots for incidental formatting, source/built mirrors without packaging risk, and local/daemon mirrors made structural by transport.

## Must Not Complete While

Any command family is unclassified, any retained scenario lacks a CLI-specific failure, or duplicated domain lifecycle behavior remains.

## Done When

The inventory has zero unresolved rows and the retained CLI portfolio maps one-to-one to parsing, confirmation, rendering, exit-status, terminal, or packaging risks.

## Acceptance Evidence

Provide the command/scenario/disposition matrix and before/after executable-test and authored-support LOC.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.
