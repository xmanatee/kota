---
id: task-migrate-historical-run-metadata-safely
title: Migrate historical workflow run metadata safely
status: backlog
priority: p0
area: workflow-runtime
summary: Add explicit historical run-metadata migration and resilient derived projections so stale terminal artifacts cannot prevent daemon startup or automation recovery.
task_class: Platform
depends_on: [task-repair-run-state-scope-schema-migration]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Current strict metadata parsing rejects historical schemaRef forms, top-level token and cost fields, older statuses, agent steps without usage envelopes, and synthetic evidence directories placed under .kota/runs. Pruning, health auditing, and autonomy-issue projection can turn one stale terminal artifact into a daemon-startup failure, even though fresh run writing is valid.

## Desired Outcome

Persisted run metadata has an explicit schema version and one canonical current representation. Daemon-owned migration preserves historical usage and lifecycle facts, derived projections tolerate or quarantine unreadable terminal history with observable warnings, and authority-critical active runs still fail closed. Evidence and fixture directories no longer masquerade as workflow runs.

## Constraints

- Preserve recoverable history and usage rather than deleting old runs or silently zeroing known values.
- Distinguish stale terminal evidence from active, waiting, integrating, or recovery-critical state before deciding whether to continue.
- Keep current writes strict and singular; migration support is a versioned transition, not permanent dual-output compatibility.
- Regenerate derived projections from canonical records and prevent malformed projection cache entries from blocking startup.
- Give non-run evidence a separate owned directory and remove code that scans arbitrary .kota/runs children as canonical metadata.

## How We Will Know

- A representative corpus of historical metadata versions migrates losslessly enough for status, usage, workflow, trigger, steps, and provenance views.
- One malformed stale terminal artifact produces a bounded diagnostic or quarantine result and does not stop the daemon.
- Malformed active or recovery-critical records still fail closed with a precise operator action.
- Pruning, health auditing, progress review, and autonomy-issue projection consume one migrated reader instead of implementing their own tolerance.
- Fresh daemon restart and workflow dispatch remain healthy after migration.

## Source / Intent

Observed while restoring workflow-backed task authoring on 2026-08-27: current code rejected older token/cost fields, missing agent usage, legacy statuses, and a synthetic control-monitor artifact under .kota/runs. The local state was preserved before any recovery conversion.
