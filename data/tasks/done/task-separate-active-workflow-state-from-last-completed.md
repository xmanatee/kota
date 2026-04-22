---
id: task-separate-active-workflow-state-from-last-completed
title: Separate active workflow state from last-completed workflow state
status: done
priority: p2
area: core
summary: Stop .kota/workflow-state.json from mixing an active run id under lastRunId with a previous run's lastCompletedAt/lastStatus so dashboards and monitors cannot trust stale completion fields during a live run
created_at: 2026-04-21T15:52:42.723Z
updated_at: 2026-04-22T03:59:48.189Z
---

## Problem

`.kota/workflow-state.json` conflates the currently running workflow run with
the last completed one. During an active explorer run, the file reported
`workflows.explorer.lastRunId` as the active run while still carrying
`lastCompletedAt` and `lastStatus` from the previous run.

- Operator and dashboard surfaces can display a workflow as both "running
  now" and "last completed success" simultaneously.
- Monitors that compare `lastRunId` against completion fields end up
  comparing data from two different runs.
- The current shape admits illegal combinations instead of modeling active
  and completed as distinct states.

## Desired Outcome

Active / latest-started state and last-completed state are modeled as
separate concepts, and the persisted shape cannot represent a completion
belonging to a different run than the active one.

- Either split the per-workflow record into `active` and `lastCompleted`
  slots, or clear completion fields when `lastRunId` advances to a running
  run and repopulate them only on completion / interruption.
- Persisted state reconstructs correctly across crashes mid-turn, consistent
  with the "session state must be reconstructible from append-only logs"
  autonomy decision.

## Constraints

- Use a discriminated shape rather than overloaded optional fields; no
  `{ lastRunId, lastStatus?, lastCompletedAt? }` where the combination is
  ambiguous.
- Migrate or normalize existing state files once at load time; do not ship a
  compatibility dual-path that carries both shapes forever.
- Do not break existing consumers of workflow-state for dashboards / clients;
  update their typed reads as part of the change.

## Done When

- `.kota/workflow-state.json` represents active and completed state with
  fields that cannot belong to different runs simultaneously.
- A persistence test runs a workflow through start → completion and start →
  interruption and asserts the file shape at each step.
- Any dashboard / monitor consumers in the daemon control API are updated to
  read the new shape and no longer infer completion from `lastRunId`.

