---
status: open
priority: p1
---
# Follow existing repair tasks through incident resolution

## Problem

Improver run `2026-09-12T14-14-09-867Z-improver-9bdwmi` correctly named
`task-make-security-review-handoffs-readable-to-agents` as the repair owner,
but published `observe` with `taskId: null`. The disposition schema cannot name
an existing task, and `disposition-publication.ts` records only newly materialized
task IDs. Useful reasoning is lost before reconciliation can follow the repair.
The cited run does not prove the underlying security finding was resolved.

## Outcome

Make an existing repair task a first-class use of the current issue/task link,
not an extra tracking store or a new reflective workflow. Validate that the
same-scope task exists and is a relevant owner; preserve its task contract and
claim. Reviewers may choose a current owner without creating duplicate work.
Route that relationship through existing disposition publication and issue
reconciliation. Replace prose-only ownership instructions and redundant paths.

## Acceptance

An open or externally blocked repair task can own the incident without another
task or owner question. The link survives restart. Missing, dropped, or genuinely
superseded ownership triggers reassessment using the surviving task lineage;
it does not silently resolve or duplicate the incident. A completed task permits
checking its outcome and later recurrence; task closure alone is never proof
of repair. Preserve genuine external-service observation without a task.

Extend the existing disposition/reconciliation owner cases for these effects;
do not duplicate the runtime-issue observation/attribution proof task or add a
new incident state machine. Use the retained disposition as a regression input,
not copied production data or a permanent per-incident fixture catalog.
