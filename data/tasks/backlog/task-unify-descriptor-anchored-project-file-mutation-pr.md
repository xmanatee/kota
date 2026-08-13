---
id: task-unify-descriptor-anchored-project-file-mutation-pr
title: Unify descriptor-anchored project file mutation primitives
status: backlog
priority: p1
area: architecture
task_class: Platform
summary: Replace duplicated task-claim and repo-task no-follow filesystem implementations with one audited descriptor-anchored primitive owned by the core filesystem boundary.
created_at: 2026-08-13T10:15:23.613Z
updated_at: 2026-08-13T10:15:23.613Z
---

## Problem

Recent security repairs independently introduced
`task-claim-filesystem-common-source.ts` and
`repo-mutation-filesystem-common-source.ts`. Both implement the same sensitive
primitives: descriptor-anchored directory traversal, identity comparison,
optional `lstat`, `O_NOFOLLOW` capability checks, refusal serialization, and
isolated helper execution. Their domain operations differ, but duplicating the
security boundary creates two implementations to audit and allows fixes for
path races or platform behavior to drift.

## Desired Outcome

Own descriptor-anchored, no-follow filesystem traversal and primitive file
operations in one core boundary. Task claims and repository task mutations
compose their domain-specific operations on that boundary without sharing
domain lifecycle state or weakening fail-closed behavior.

## Constraints

- Consolidate only genuinely common security primitives; claim leases and task
  markdown lifecycle remain separate domain mechanisms.
- Preserve descriptor-relative operations, identity revalidation, atomic
  installation, regular-file checks, and explicit refusal when required host
  primitives are unavailable.
- Delete superseded helper source and tests in the same change. Do not retain
  aliases or compatibility wrappers.
- Keep the helper protocol typed and make errors observable; do not convert
  security failures into booleans or swallowed fallbacks.

## Done When

- Claims and repo-task mutations import or generate their low-level operations
  from one owner, with no copied implementations of identity, no-follow open,
  anchored traversal, or helper response handling.
- Existing direct-leaf, parent-symlink, replacement-race, and cross-project
  scenarios exercise both consumers through the shared boundary.
- Platform capability rejection is tested once at the shared boundary while
  each domain retains focused lifecycle behavior coverage.
- Source and duplication scans show the superseded common-source mechanisms
  are absent.

## Source / Intent

Created from the owner-requested review of the last 50 commits on 2026-08-13.
The duplicated implementations were introduced by canonical task-mutation and
task-claim security repairs and currently total roughly 400 lines before their
domain-specific helper sources.

## Initiative

One audited filesystem authority boundary.

## Acceptance Evidence

- Focused shared-boundary and two-consumer race/symlink fixture transcript.
- Before/after structural search or duplication report naming the removed
  implementations and the single surviving owner.
