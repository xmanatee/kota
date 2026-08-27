---
id: task-make-task-authoring-atomic-and-complete
title: Make task authoring atomic and complete
status: backlog
priority: p0
area: repo-tasks
summary: Let the canonical task API create and revise a complete valid task record atomically, including class, intent, dependencies, anchor status, and queue placement.
task_class: Platform
depends_on: [task-migrate-historical-run-metadata-safely]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

The normalized create contract accepts title, priority, area, state, and summary but every open task also requires task_class and often needs depends_on, anchor, and a real intent body. updateBody preserves frontmatter and cannot complete metadata. The CLI tells agents to scaffold and edit afterward, while canonical task mutations require workflow authority and validation can reject the incomplete scaffold before it integrates.

## Desired Outcome

One repo-tasks authoring command and client contract accepts the complete task intent and supported metadata, validates the whole record before writing, and commits it through the existing repo-task-mutation workflow. Partial metadata updates, dependency changes, and anchor progress use the same authorized domain rather than direct file edits or another writer.

## Constraints

- Extend the existing repo-task domain and writer workflow; do not create a second task mutation route, lock, staging mechanism, or file writer.
- Keep safe paths, stable identifiers, logical task resources, lifecycle rules, dependency validation, integration, and rollback owned by their current authorities.
- Make simple task creation ergonomic without hiding required semantics or inventing compatibility aliases for the incomplete contract.
- Support complete bodies as intent records without mechanically requiring specific headings or test-artifact language.
- Reject invalid or conflicting records atomically before canonical integration.

## How We Will Know

- A normal CLI or client call can create a queue-valid Product, Safety, Platform, or Meta task without a manual follow-up edit.
- Dependencies, anchor metadata, and body intent can be authored and updated through the same workflow-backed boundary.
- A failed validation leaves neither an incomplete committed scaffold nor uncommitted canonical task edits.
- Inbox sorter, progress reviewer, decomposer, improver, security reviewer, and human operators converge on the same authoring contract.
- The temporary task-plan writer used to bootstrap this program is unnecessary once this slice lands.
