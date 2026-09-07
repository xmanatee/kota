---
status: open
priority: p1
---
# Verify historical metadata repair and disposition the cited runtime-health failure


## Problem

The historical metadata repair is integrated, but runtime:historical-run-metadata-repair still lacks verified closure. The task reports that run 2026-08-24T12-19-13-793Z-builder-689rsi no longer has a durable row or metadata file, and that dead letter dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687 was redriven as 2026-09-07T13-33-18-949Z-runtime-health-auditor-ywbldz. Replay success, current startup behavior, and the dead letter's final disposition require inspectable evidence.

## Desired Outcome

Resolve the finding using evidence from scope kota (8nrg1m): establish the exact historical source's retention status, verify a successful same-scope runtime-health audit, assess the integrated startup repair, and record the cited dead letter's explicit disposition with supporting evidence.

## Constraints

- Preserve references to dead-letter:dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687, state:recovery, the exact historical run, and the named replay.
- First inspect the failed builder 2026-09-07T16-05-20-034Z-builder-zdj0si and the operator capture at .kota/runs/blocked-task-review-2026-09-07/task-generated-ef5ef9674b330435.diagnostics.json through permitted evidence surfaces. If required evidence is inaccessible or incomplete, record a concrete operator-capture blocker through repo-task operations; do not claim completion or bypass access restrictions.
- Distinguish permission denial from confirmed absence. Never reconstruct nonexistent historical metadata, fabricate a backup, delete evidence, or substitute another malformed run as proof about the cited source.
- For retained eligible malformed records, preserve runtime-owned repair requiring agreement among durable run authority, workflow snapshot, and trigger snapshot, plus strict validation and a retained source backup. Keep disagreement fail-closed.
- Do not repeat the integrated repair or weaken automatic dead-letter supersession to accommodate absent history. Make implementation changes only for a demonstrated remaining defect.
- Any necessary live audit dispatch or dead-letter disposition belongs to an authorized operator or runtime control path outside the repository writer. Do not restart or control the launching daemon or directly edit operational state.

## How We Will Know

- Inspectable evidence identifies scope 8nrg1m and establishes whether both the durable row and metadata for the exact historical run are absent; absence is recorded without claiming that run was repaired.
- The named replay has a verified terminal outcome. A successful same-scope runtime-health audit is cited; if the replay failed, its failure is explicitly accounted for and subsequent successful audit evidence is required before closure.
- Current startup repair behavior is assessed using the integrated production path and proportionate existing behavioral checks, including retained-source preservation and rejection of disagreeing authority. Fixture results are distinguished from host observations.
- The cited dead letter has an inspectable explicit disposition linked to the replay or authorized operator action, and current recovery evidence explains any remaining relevant blocker.
- The terminal task record links the supporting evidence and resolves runtime:historical-run-metadata-repair only when these conditions hold; missing operational prerequisites leave an explicit blocked task.

## Context

Decomposed from `task-generated-ef5ef9674b330435` after builder run `2026-09-07T16-05-20-034Z-builder-zdj0si` exhausted repair.
