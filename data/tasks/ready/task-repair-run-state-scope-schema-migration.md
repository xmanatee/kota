---
id: task-repair-run-state-scope-schema-migration
title: Repair run-state scope schema migration
status: ready
priority: p0
area: workflow-runtime
summary: Add the missing durable migration from project-named workflow tables and columns to the canonical scope schema so existing KOTA installations can start automations safely.
task_class: Platform
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

A live schema-version-3 database can still contain projects, runs.project_id, project_state_values, and project-linked publications. Current code assumes scopes and scope_id, so daemon startup and status fail with no such column: scope_id even though the database claims to be current. This blocks every workflow-backed task mutation.

## Desired Outcome

The next schema version transactionally converts the complete legacy project-shaped run-state schema to scope ownership while preserving runs, admissions, state values, publications, effects, resources, and referential integrity. New databases start directly in the canonical schema, and permanent dual-schema behavior is not introduced.

## Constraints

- Use a versioned daemon-owned migration with rollback-on-failure and no destructive reset of durable history.
- Convert table names, column names, indexes, uniqueness rules, and foreign keys; do not stop at query aliases.
- Handle partially migrated version-3 databases that already contain empty scopes and scope_state_values tables.
- Remove project-schema compatibility logic once the one-way migration is authoritative.

## How We Will Know

- An existing project-shaped version-3 database opens through the normal daemon path and retains all records with clean integrity and foreign-key checks.
- Fresh database creation and already-migrated database startup remain normal observable paths.
- Daemon status and a workflow-backed task mutation no longer fail on scope_id.
- The migration is represented once in schema ownership rather than copied into callers.

## Source / Intent

Observed locally on 2026-08-27. The runtime database reported user_version 3 while runs and several related tables still used project_id. A preserved local database was recovered transactionally to unblock task authoring; product code still needs the durable migration.
