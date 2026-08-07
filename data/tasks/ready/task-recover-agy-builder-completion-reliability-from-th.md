---
id: task-recover-agy-builder-completion-reliability-from-th
title: Recover AGY builder completion reliability from the zero-success rollout
status: ready
priority: p1
area: autonomy
task_class: Platform
summary: Reconstruct every failed AGY builder attempt, fix the shared runtime causes, and prove builders can complete without losing or corrupting work.
created_at: 2026-08-07T01:04:32.818Z
updated_at: 2026-08-07T01:04:32.818Z
---

## Problem

The first AGY rollout produced successful review and improver agent steps but
zero successful builder completions. The failed builder runs included repeated
`Individual quota reached` terminal outcomes and native sandbox/cascade errors
while opening worktree Git metadata or executables such as
`node_modules/.bin/vitest`. Some attempts consumed tens of minutes or hours
before failing. The failures were later recovered operationally, but there is
no complete root-cause matrix proving which defects belonged to AGY, KOTA's
native sandbox projection, quota handling, worktree lifecycle, or the task
itself.

Without that analysis, another AGY rollout can preserve the same zero-success
builder behavior while doctor and lightweight agent steps appear healthy.

## Desired Outcome

Reconstruct every AGY builder attempt from the rollout window and assign each
one an evidence-backed terminal cause. Fix the shared runtime paths so an AGY
builder can inspect its allowed workspace, edit only the task scope, run the
declared verification, produce a stageable commit, transition the task, and
cleanly dispose its claim/worktree.

Quota exhaustion must preserve useful work and create one resumable provider
incident rather than repeated builder churn. Ambiguous or partially useful
branches remain reviewable; no failure path may discard uncommitted changes.

## Constraints

- Do not broaden AGY filesystem or process authority merely to make a run pass.
  Git metadata remains read-only to native agents and KOTA owns staging and
  commits.
- Do not classify every failure as provider quota. Separate provider, sandbox,
  adapter, verification, repair-loop, and task-quality causes.
- Do not add blind timeouts, fixed retry counts, or automatic work discard.
- Reuse the canonical provider backoff, recovery projection, claim, DLQ, and
  worktree lifecycle mechanisms; do not add AGY-only shadow state.
- Audit the final diff for rushed implementation, ignored examples, unrelated
  edits, generated debris, and incomplete verification.

## Done When

- A root-cause table covers every AGY builder attempt in the rollout window,
  including duration, task, terminal error, preserved work, retry/disposition,
  and responsible subsystem.
- Focused fixtures reproduce each KOTA-owned failure class before the fix and
  demonstrate the corrected behavior afterward.
- At least one representative AGY builder run completes the full builder
  lifecycle with a valid commit and task transition.
- The completed run leaves no active claim, stale worktree, open duplicate DLQ,
  dirty canonical checkout, or provider retry storm.
- A quota failure after useful edits preserves and later resumes the same work
  without restarting from an empty branch.

## Source / Intent

Owner direction on 2026-08-07: investigate and improve the local evidence of
quota exhaustion and zero successful AGY builder completions before trusting
AGY-backed continuous autonomy.

Representative failures include builder runs ending on provider quota reset
windows and native cascade `operation not permitted` errors against worktree
`.git` metadata and `node_modules/.bin/vitest`. Successful non-builder AGY runs
do not satisfy this task.

## Initiative

Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- `.kota/runs/<run-id>/agy-builder-recovery/incident-matrix.json` linking each
  historical run to its evidence and disposition.
- A successful builder run directory containing the AGY event trace, scoped
  diff, verification output, commit, task transition, claim release, worktree
  cleanup, and final recovery projection.
