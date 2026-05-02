---
id: task-enforce-ready-queue-discipline-and-backlog-promoti
title: Enforce ready-queue discipline and backlog promotion rationale
status: done
priority: p1
area: autonomy
summary: Make dispatcher, explorer, and builder maintain an intentional short execution queue so builders stop silently treating backlog as ready work when the ready queue is empty.
created_at: 2026-04-29T12:53:09.377Z
updated_at: 2026-05-02T15:42:38.417Z
---

## Problem

The ready queue is supposed to be the short, intentional execution queue, but
the current repo state had `ready: 0` while backlog still contained normalized
work. Builder guidance allows promotion from reserve work when there is no
short-queue task, so the system keeps producing commits even though no workflow
or operator has deliberately selected near-term work.

That weakens execution quality in two ways:

- dispatcher reports `autonomy.queue.available` with backlog-only counts, then
  builder can still pull reserve work;
- explorer and queue-shaping decisions are not forced to explain why the next
  task is the right one compared with blocked architecture work, stale
  blockers, accepted critic debt, or operator-facing regressions.

An empty `ready/` should be a planning signal, not a loophole.

## Desired Outcome

Dispatcher, explorer, and builder maintain an intentional short execution
queue. When `ready/` is empty, the autonomous loop must either promote a small
batch of the best actionable tasks with a visible rationale, ask/unblock what
is preventing better work, or no-op with a clear queue-health reason. Builder
should not silently treat all backlog tasks as equivalent ready work.

The system can still keep moving, but every backlog promotion must be
inspectable: why this task, why now, what alternatives were rejected, and how
the choice advances current repo priorities.

## Constraints

- Do not add blunt spend caps or calendar throttles as the primary fix.
- Keep task state semantics intact: `backlog` is reserve, `ready` is selected,
  `blocked` is not actionable, `doing` is real WIP.
- Do not make operators manually curate every task. Automation may promote
  tasks, but it must leave evidence and respect the short-queue contract.
- Prefer deterministic queue-health checks and focused workflow changes over
  prompt-only reminders.
- Preserve reliability: if there is genuinely urgent actionable work, the loop
  should promote and run it rather than stall.

## Done When

- Builder no longer pulls directly from backlog without a promotion rationale
  artifact, task move, or explicit queue-health decision recorded in the run
  directory.
- Dispatcher or explorer can promote a bounded ready batch from backlog when
  ready is empty, using criteria that consider priority, area, stale blockers,
  accepted critic debt, and strategic architecture front.
- The promotion decision records at least:
  - candidate tasks considered;
  - selected task(s);
  - rejected higher-priority blocked/unactionable alternatives;
  - reason this work is better than waiting or creating new tasks.
- Tests cover empty-ready/backlog-present, ready-present, blocked-only, and
  backlog-promotion cases.
- `data/tasks/ready/` stays non-empty after this task's own completion unless
  the queue-health artifact explains why no task is currently actionable.

## Source / Intent

Owner asked on 2026-04-29 for KOTA workflows to address all execution-quality
issues. The same day's report showed open queue state as 10 backlog, 8
blocked, 0 ready, and 0 doing. Recent dispatcher events repeatedly emitted
`autonomy.queue.available` with `ready: 0` and backlog counts, while builder
runs continued to commit tasks.

## Initiative

Autonomy queue discipline: selected work should be deliberate and auditable,
not an emergent consequence of backlog order.

## Acceptance Evidence

- Workflow/unit test output for ready-present, empty-ready, blocked-only, and
  promotion-rationale scenarios.
- A run-directory promotion artifact from a simulated or live empty-ready run.
- Updated builder/dispatcher/explorer scoped guidance or code comments only
  where they describe the durable queue contract.
