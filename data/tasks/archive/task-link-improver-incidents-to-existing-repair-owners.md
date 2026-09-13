---
status: done
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

## Resolution

Improver can now publish `link-task` with an explicit existing task identity.
The shared generated-work transaction checks that the same-scope task exists,
is not dropped, and retains its reviewed body through publication. Linking
does not rewrite or retire the task, reopen completed work, or acquire its
runtime claim. The reviewer judges relevance from the task outcome contract
and records that relationship in its rationale.

Publication uses the existing issue/task link and reconciliation policy. Open
and externally blocked tasks remain owners; done tasks await outcome verification.
Missing or dropped/superseded owners require review with their surviving lineage.
Clear observations preserve the previous task identity for recurrence review.
Unowned external-service observation remains available.

Verification extends the disposition, materialization, reconciliation, clear,
and workflow owner cases. The retained September 12 disposition was replayed
from this run's scoped export against the real publication and SQLite owners:
the original action produced no link; the explicit action preserved its named
repair task, survived database reopen, and remained open/validating despite
the task now being done. This is deterministic regression evidence, not a new
model evaluation or proof that the original security finding was repaired.

The new workflow journey and 57 affected owner tests passed. Broader runtime
journeys and static/build results, including environment limitations, are
recorded in this builder run's summary and logs.
