---
id: task-reconcile-dirty-recovery-pause-state-across-status
title: Reconcile dirty recovery pause state across status and startup
status: backlog
priority: p1
area: workflow-runtime
summary: Make dirty-checkout recovery pause reasons accurate, self-clearing when the worktree is clean, and visible consistently across daemon dashboard, status, workflow status, and shared UI.
created_at: 2026-07-06T15:16:35.786Z
updated_at: 2026-07-06T15:16:35.786Z
task_class: Platform
---

## Problem

After the dirty checkout was committed, `git status` was clean but
`kota status` still reported the old pending dirty-checkout recovery record.
The runtime startup path would clear that recovery marker once the daemon
starts, but offline status reads the persisted marker directly and can show a
false warning.

The same recovery/pause state is also split across the dashboard activity log,
workflow status, `.kota/workflow-state.json`, the pause signal file, and shared
UI surfaces. That makes it hard for an operator to tell whether dispatch is
paused because of a real dirty checkout, a stale marker, a persistent pause
request, or an in-memory dirty-recovery stop.

## Desired Outcome

Recovery and pause state should have one clear reconciliation path. Status
surfaces must agree with runtime startup about whether the recovery marker is
still valid for the current checkout.

When the worktree is clean, stale dirty-checkout recovery markers should be
cleared or suppressed consistently before any operator-facing status claims
there is pending recovery. When the worktree is dirty, every operator surface
should show the same source workflow, run id, dirty checkout, summary,
attempt count, and next safe action.

`kota workflow resume`, `kota status`, daemon dashboard state, and the shared
`runs` UI surface must distinguish persistent operator pause from dirty
recovery pause.

## Constraints

- Put reconciliation in the workflow/runtime layer or a shared helper owned by
  that layer. Do not let each client infer recovery truth independently.
- Do not hide a real dirty checkout. If git status is unavailable, surface that
  explicitly instead of clearing recovery state.
- Preserve the dirty-worktree safety guard: autonomous workflows must not
  resume into an unowned dirty canonical checkout.
- Keep status commands fast; use simple git/status probes and targeted runtime
  state reads only.

## Done When

- With a clean worktree and a stale recovery record, `kota status`,
  `kota workflow status`, `kota ui render status`, and daemon startup all agree
  that no dirty recovery is pending.
- With a dirty worktree and a recovery record, every status surface reports the
  same reason and next action.
- Persistent operator pause and dirty-recovery pause are rendered as distinct
  states.
- Restarting the daemon after cleanup does not flash or persist a stale
  dirty-recovery warning.

## Source / Intent

Runtime incident on 2026-07-06/2026-07-07: daemon paused after startup because
the canonical checkout was dirty. After the patch was committed,
`git status --short` was clean, but source-mode `kota status` still printed
`Pending recovery: dirty canonical checkout from improver`. Investigation
found `queueRecovery()` clears clean recovery state on startup, while offline
status renders `state.recovery` without reconciling current git state.

## Initiative

Runtime safety and operator clarity: dirty-worktree protection should be
accurate, explainable, and never stale.

## Acceptance Evidence

- Transcript under `.kota/runs/<run-id>/transcript.txt` showing a synthetic or
  fixture stale-recovery state with a clean worktree and all status surfaces
  agreeing that no pending dirty recovery remains.
- Transcript or fixture showing a real dirty recovery state and the matching
  reason across daemon dashboard/status/workflow/shared UI.
- Focused tests for recovery reconciliation, offline status rendering, daemon
  startup reconciliation, and workflow resume/pause messaging.
