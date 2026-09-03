---
status: open
priority: p1
---
# Repair historical run metadata blocking runtime-health audit

## Problem

An open runtime-health-auditor dispatch fails closed because a historical builder run has invalid authority-bearing metadata. No active task in the canonical queue owns this distinct failure, so runtime-health evidence remains incomplete while recovery already reports items needing attention.

## Desired Outcome

Resolve the progress-review finding identified by topic runtime:historical-run-metadata-repair.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## How We Will Know

The cited historical run is reconciled from its durable workflow and trigger authority through a runtime-owned safe repair path, the metadata passes current schema and provenance validation, a same-shape runtime-health audit reaches success without weakening fail-closed handling, and the cited dead letter receives a durable terminal disposition.

## Context

Created by progress-reviewer from the cited evidence.
review verdict: needs-steering
review summary:

    Directory scope kota (8nrg1m), automatic semantic-boundary review of task-disposition revision 8 for 2026-09-02T09:29:13.832Z through 2026-09-03T09:29:13.832Z. Included evidence comprises 20 runs, 32 tasks, 40 artifacts, 60 Git records, 16 state records, and 20 representative dead letters within 188 exposed evidence items; detailed run, artifact, Git, and dead-letter records were truncated, and malformed historical run evidence was excluded as recorded in the packet. Foundational onboarding, workflow-verification, and recall-adapter work reached done, leaving the end-to-end onboarding proof dependency-clear. Delivery remains active, but two new onboarding security findings, 90 open dead letters, and five recovery items needing attention prevent an on-track verdict. Existing tasks already own the evaluator-calibration and progress-reviewer failures. Applied action: propose one non-duplicate repair for the historical metadata failure blocking runtime-health auditing; no owner question or resolution is warranted.

Evidence ids:

- dead-letter:dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687
- state:recovery
