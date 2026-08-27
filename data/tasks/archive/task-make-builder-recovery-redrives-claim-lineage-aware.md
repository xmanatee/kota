---
status: dropped
---

# Make builder recovery redrives claim-lineage aware

## Problem

    Make retries and dead-letter redrives of preserved builder recovery work continue one validated claim, worktree, and evidence lineage instead of replaying claim output owned by an earlier physical run.

## Desired Outcome

Resolve autonomy issue autonomy-issue-d738e5fc632c146872f8 at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## Done When

- The issue's root cause is fixed or disproven with inspectable evidence.
- A typed clear observation or explicit disposition resolves the durable issue.

## Source / Intent

Issue reviewer disposition:     Run .kota/runs/2026-08-23T04-29-21-206Z-builder-oc3xup/metadata.json reused the prior run's successful claim-task output, whose claim remained owned by builder/2026-08-23T03-21-50-965Z-builder-wku7fd, then executed prepare-worktree under a new run ID and failed with an ownership mismatch. Dead letter dlq-0266b49d-b48a-428c-955a-432e63d8eff3 confirms the redrive cannot progress. Existing recovery tasks cover native conflict resolution and terminal DLQ disposition, not run-scoped claim ownership during retry replay.

Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-0266b49d-b48a-428c-955a-432e63d8eff3
- run: .kota/runs/2026-08-23T04-29-21-206Z-builder-oc3xup/metadata.json

## Product / Safety Link

This issue repair protects Product and Safety throughput by removing a durable autonomy failure or review gap before it consumes builder capacity.

## Initiative

One autonomy issue, one decision, one implementation path.

## Acceptance Evidence

-     A production-shaped fixture creates a preserved-work recovery run that claims the task, fails after claiming, and is redriven with retryOf; the retry progresses past prepare-worktree with valid current-run claim ownership while retaining the same task, worktree, and evidence lineage and creating no duplicate builder. A negative fixture proves an unrelated advanced claim fails closed. Focused retry-runtime tests prove run-scoped mutating setup and its producers are not blindly replayed across physical run IDs. A runtime projection for the reported lineage shows the related dead letter terminally dispositioned and the claim/worktree either validly continued or terminal.

- Source: improver; run: 2026-08-23T07-11-46-761Z-improver-grauks
  - Issue: autonomy-issue-d738e5fc632c146872f8; revision: 1
  - Evidence: .kota/dead-letter-queue/items.json#dlq-0266b49d-b48a-428c-955a-432e63d8eff3
  - Evidence: .kota/runs/2026-08-23T04-29-21-206Z-builder-oc3xup/metadata.json
