---
id: task-make-task-authoring-atomic-and-complete
title: Make task authoring atomic and complete
status: backlog
priority: p0
area: repo-tasks
summary: Make the existing repo-tasks command and workflow create or revise one complete valid task record without scaffold-and-edit gaps.
task_class: Platform
depends_on: [task-migrate-historical-run-metadata-safely]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Problem

`RepoTaskCreateOptions` and `createNormalizedTask` accept only title, priority, area, state, and summary. Open tasks also require `task_class` and commonly require `depends_on`, `anchor`, and a substantive intent body. `updateTaskBody` preserves frontmatter, forcing an incomplete scaffold plus a separate metadata edit that the public API cannot perform.

## Scope / Starting Points

- `src/modules/repo-tasks/client.ts`
- `src/modules/repo-tasks/repo-tasks-operations.ts`
- repo-task CLI and daemon route request decoding
- repo-task mutation workflow, candidate validation, and integration

## Required Changes

- Extend create input with `task_class`, `depends_on`, `anchor`, complete body intent, and supported initial state.
- Add one complete-record revision operation for body and supported metadata; do not add another writer, lock, staging mechanism, or mutation route.
- Validate identifiers, state-directory agreement, task class, dependencies, anchor rules, and the full candidate queue before canonical integration.
- Preserve safe paths, logical task resources, rollback, and workflow-owned commits.
- Keep the simple CLI ergonomic while never committing a placeholder that requires a direct file edit to become valid.

## Must Not Complete While

- A valid task still requires a manual frontmatter or body edit after creation.
- A failed create or revision can leave a canonical scaffold, partial metadata, or uncommitted task edit.
- CLI, daemon, task-producing automations, and human operators use different mutation contracts.

## Done When

- One public create call round-trips every supported field for Product, Safety, Platform, and Meta tasks.
- The same boundary updates body, dependencies, anchor progress, and supported metadata atomically.
- Invalid dependency, metadata, or lifecycle changes leave canonical task state unchanged.
- All task-producing automations use the same complete contract.

## Acceptance Evidence

Show successful create/show/update round-trips, rejected invalid candidates with unchanged canonical state, and removal of scaffold-follow-up instructions from CLI and automation guidance.

## Source / Intent

The existing incomplete contract forced this initiative to be bootstrapped outside the normal create call. No temporary writer remains in the repository.

## Initiative

KOTA must be able to improve its own queue through one trustworthy domain boundary.
