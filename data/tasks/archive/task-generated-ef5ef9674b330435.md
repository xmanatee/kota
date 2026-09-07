---
status: dropped
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

Retained malformed runs reconcile through the runtime-owned durable-authority path without weakening validation. A same-scope runtime-health audit succeeds and the cited dead letter has an explicit disposition. If the exact historical source is no longer retained, document that absence instead of fabricating repair evidence.

## Context

Created by progress-reviewer from the cited evidence.
review verdict: needs-steering
review summary:

    Directory scope kota (8nrg1m), automatic semantic-boundary review of task-disposition revision 8 for 2026-09-02T09:29:13.832Z through 2026-09-03T09:29:13.832Z. Included evidence comprises 20 runs, 32 tasks, 40 artifacts, 60 Git records, 16 state records, and 20 representative dead letters within 188 exposed evidence items; detailed run, artifact, Git, and dead-letter records were truncated, and malformed historical run evidence was excluded as recorded in the packet. Foundational onboarding, workflow-verification, and recall-adapter work reached done, leaving the end-to-end onboarding proof dependency-clear. Delivery remains active, but two new onboarding security findings, 90 open dead letters, and five recovery items needing attention prevent an on-track verdict. Existing tasks already own the evaluator-calibration and progress-reviewer failures. Applied action: propose one non-duplicate repair for the historical metadata failure blocking runtime-health auditing; no owner question or resolution is warranted.

Evidence ids:

- dead-letter:dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687
- state:recovery

## Blocked on

```
kind: operator-capture
path: .kota/runs/blocked-task-review-2026-09-07/task-generated-ef5ef9674b330435.diagnostics.json
description: inspectable host diagnostics for final task review; no canonical credentials required
```

## Operational evidence (2026-09-07)

Repair implementation was integrated in 5bb1b41e8 and the daemon was restarted on current code. The exact run cited by dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687 is 2026-08-24T12-19-13-793Z-builder-689rsi. Both its durable run row and its metadata file are now absent. Do not confuse it with another malformed historical run or fabricate a repair backup.

The cited dead letter was redriven through the owning control API as 2026-09-07T13-33-18-949Z-runtime-health-auditor-ywbldz. Verify that replay reaches success and assess current startup repair behavior. For a retained malformed record require the existing durable-authority validation and backup; for a source no longer retained, record its absence and current same-scope audit result instead of requiring reconstruction of nonexistent evidence. Do not delete evidence or weaken authority checks.

## Decomposed

- task-verify-historical-metadata-repair-and-disposition