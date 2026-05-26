---
id: task-make-explorer-handle-strategic-ready-coverage-gaps
title: Make explorer handle strategic-ready coverage gaps before watchlist-only exits
status: ready
priority: p2
area: autonomy
summary: Teach explorer to treat a p3-only ready queue as actionable strategic queue work before committing watchlist-only or noop runs.
created_at: 2026-05-26T20:50:09.597Z
updated_at: 2026-05-26T20:50:09.597Z
---

## Problem

Explorer already receives `inspect-queue.strategicReadyCoverageGap`, and the
repair loop enforces `strategic-ready-coverage`, but the agent-facing decision
contract does not make that gap a first-class reason to act before
`watchlist-only` or `noop`.

Run `2026-05-26T20-45-51-721Z-explorer-fywb7y` hit that exact shape:

- `data/tasks/ready/` contained one actionable task, but it was only `p3`.
- `inspect-queue.json` reported `strategicReadyCoverageGap: true`.
- Every strategic blocked alternative was still `movable: false`.
- Explorer chose `decision: "watchlist-only"` after refreshing SWE-Cycle,
  leaving the queue unchanged.
- The post-check then failed on `strategic-ready-coverage`, forcing a repair
  attempt to do the queue-shaping work the first pass should have selected.

The existing eval/replay fixtures prove the repair loop can catch this
failure after the fact. They do not stop live explorer runs from spending an
extra agent turn on a gap that was already visible in the inspect step.

## Desired Outcome

Explorer treats a strategic-ready coverage gap as actionable queue work before
committing `watchlist-only` or `noop` output.

In the p3-only ready-queue shape, explorer should either promote, decompose, or
create a `p0`/`p1`/`p2` ready task with a rationale that explains why existing
strategic blocked alternatives could not move. If no such action is valid, the
failure should be explicit before the commit path, not left to a generic
post-check repair.

## Constraints

- Keep the `strategic-ready-coverage` invariant strong; do not relax
  `assertStrategicReadyCoverage` or downgrade the check to a warning.
- Do not fabricate priority by upgrading a low-severity task unless the task's
  domain urgency actually changed.
- Preserve legitimate `noop` and `watchlist-only` outcomes when there is no
  strategic-ready gap.
- Keep the rationale artifact typed through the existing explorer
  `exploration-rationale` boundary; avoid ad-hoc JSON parsing or a second
  rationale format.
- Do not duplicate the completed explorer strategic-ready fixture work. This
  task is about making the first-pass decision contract handle the gap.

## Done When

- Explorer prompt/workflow guidance or validation makes
  `strategicReadyCoverageGap: true` incompatible with a queue-unchanged
  `watchlist-only` or `noop` run.
- A focused test, replay fixture assertion, or workflow check covers the live
  shape from run `2026-05-26T20-45-51-721Z-explorer-fywb7y`: one p3 ready task,
  no movable strategic blocked alternatives, and an otherwise valid watchlist
  refresh.
- The same coverage proves legitimate `watchlist-only` and `noop` runs still
  pass when the ready queue already has a `p0`/`p1`/`p2` task or the queue is
  intentionally paused without a strategic-ready gap.
- Queue validation passes with at least one `p0`/`p1`/`p2` ready task.

## Source / Intent

Post-check repair for explorer run
`2026-05-26T20-45-51-721Z-explorer-fywb7y`. The failed check reported:

`data/tasks/ready must keep at least one p0/p1/p2 task. The actionable queue
has drifted to p3-only work, which is too weak for the front of the
autonomous queue.`

The run's watchlist-only SWE-Cycle update was useful but did not address the
queue-shaping gap already exposed by `inspect-queue`.

## Initiative

Autonomous queue quality: explorer should keep the front of the builder queue
strategic without relying on avoidable repair-loop retries.

## Acceptance Evidence

- Focused test or replay transcript showing the p3-only ready-queue shape
  rejects queue-unchanged `watchlist-only` / `noop` output before commit.
- `pnpm run validate-tasks` transcript showing the task queue remains valid
  and strategic-ready coverage is satisfied.
