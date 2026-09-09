---
status: open
priority: p0
---
# Restore claim-aware work supply and exploration

## Problem

At main 763e14b14 on 2026-09-09, all four open tasks have retained
needs_attention run owners, but dispatcher calls all four actionable and emits
queue.available. No builder is executing or queued. Explorer consequently sees
neither an empty nor thin queue. All six dependency edges resolve to done tasks.
The retained SQLite history since August 26 has zero explorer runs. The watchlist
has 116 sources, 115 snapshots, and its newest lastSeen is July 8.

Evidence: .kota/runs/2026-09-09T16-26-07-038Z-dispatcher-39bhit/steps/assess-and-dispatch.json;
repo-tasks-domain.ts selectActionableRepoTasks/getRepoTaskQueueSnapshot;
autonomy/queue-policy.ts; dispatcher/inspection.ts; explorer/assessment.ts.
Task eligibility is file/dependency-based while runtime resource admission
correctly rejects an already owned task. The two projections disagree.

## Desired Outcome

Give queue consumers one authoritative available-work projection joining repo
task intent with existing runtime ownership. Distinguish unclaimed runnable work,
running work, retained recovery work, dependency waits, and external blocks.
Use it in dispatcher, explorer, parked-progress detection, and operator status.
Keep final claiming atomic in the existing runtime; this read model is not a
second scheduler, claim store, or persisted task lifecycle.

Replenish genuinely thin independent work using the existing explorer and
watchlist. A blocked unrelated dependency must not veto all exploration.
Use an explainable low-water decision relative to useful available work and
capacity, not total task files. Refresh relevant sources and propose only useful,
nonduplicative opportunities. No-action is valid; record what evidence or source
change warrants revisiting, so idle ticks do not repeatedly spend agent capacity.
Source rechecks may be time-due; time alone is not evidence for another AI review.

## Constraints

- Preserve retained claims/worktrees and owner pauses/backoff. Do not count them
  as spare work or release ownership to make the queue look healthy.
- Reuse explorer admission, last actual exploration state, typed events and
  runtime deduplication. Replace contradictory availability calculations.
- The archived claim-aware queue task describes a retired lifecycle; do not
  restore ready/doing directories, claim files, or a compatibility adapter.
- This task owns work supply, not semantic reviewer strategy or blocker repair.

## How We Will Know

One boundary-level proof covers a queue containing only retained owners, mixed
available/owned work, and an unrelated dependency wait. Atomic claiming still
prevents duplicate ownership. A live resumed dispatcher explains the current
four retained runs truthfully; when independent supply is thin, one explorer
consumes fresh source evidence, creates a justified opportunity or records an
honest no-action, and does not repeat that decision on unchanged inputs.
Record trigger provenance, task/claim counts and slot refill after completion;
passing a pure queue helper alone is not end-to-end delivery evidence.