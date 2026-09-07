---
status: blocked
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

## Verification attempt (2026-09-07)

Read-only canonical SQLite observation at 2026-09-07T18:58:11.621187Z identifies
scope kota (`8nrg1m`). The exact historical run
`2026-08-24T12-19-13-793Z-builder-689rsi` has no durable row. Its metadata retention
is still unverified; the predecessor task's report of file absence is not a
fresh observation and no repair of that source is claimed.

The named replay `2026-09-07T13-33-18-949Z-runtime-health-auditor-ywbldz` is
`succeeded` with `result_status: success`, completed at 2026-09-07T15:02:18.000Z
in scope `8nrg1m`. The failed builder `2026-09-07T16-05-20-034Z-builder-zdj0si`
is durably failed: its build repair loop made no progress after three attempts,
with `target-task-resolved` and `critic-review` still failing. Reading its
metadata and the required original operator capture returned `PermissionError`,
errno 1 (`Operation not permitted`). Those errors establish inaccessibility,
not absence. Detailed critic evidence could not be inspected.

The integrated daemon startup path still owns authority-based repair and source
backup. Existing repair, startup, and supersession owner checks passed (3 files,
7 tests); they prove fixture behavior, not host startup execution. Eleven current
needs-attention rows report integration-invariant or sandbox-cleanup blockers;
this bounded projection does not replace the full `state:recovery` response.
`dead-letter:dlq-222b5895-cf3e-4d1b-a36f-28ea6ee05687` still lacks an inspected
explicit disposition. `runtime:historical-run-metadata-repair` remains unresolved.
No remaining production defect was demonstrated and no implementation changed.

Evidence for this attempt lives under
`.kota/runtime/2026-09-07t18-52-45-373z-builder-e7075c3014c4687a88cfb800fcccf862858d0570aef1c53e2ef8b9e9a2af9e7e/agent/`:
`durable-observation.json` (read-only host records), `evidence-access.json`
(permission errors), and `verification.md` (source assessment and validation).

## Blocked on

```
kind: operator-capture
path: .kota/runs/blocked-task-review-2026-09-07/task-verify-historical-metadata-repair-and-disposition.diagnostics.json
description: Writer-readable scope 8nrg1m capture of predecessor critic evidence, original diagnostics, exact historical metadata retention, startup repair observation, cited dead-letter disposition and current recovery; no credentials required
```

## Operator capture requirements

Provide the capture through a permitted evidence surface readable in the next
writer run. Include the failed builder's review diagnostics and the original
`.kota/runs/blocked-task-review-2026-09-07/task-generated-ef5ef9674b330435.diagnostics.json`,
plus timestamped metadata retention evidence for the exact historical source,
current startup repair evidence, and the explicit disposition of the cited dead
letter linked to the named successful replay or authorized operator action.
Include the current `state:recovery` projection and explain relevant blockers.
Any needed disposition action must use an authorized operator/runtime control
path outside this writer. Preserve existing evidence; do not reconstruct missing
metadata or treat permission denial as absence. A new task-specific capture path
keeps the existing inaccessible capture from being mistaken for satisfaction of
this remaining prerequisite.