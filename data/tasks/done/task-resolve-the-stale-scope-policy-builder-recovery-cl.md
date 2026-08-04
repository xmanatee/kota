---
id: task-resolve-the-stale-scope-policy-builder-recovery-cl
title: Resolve the stale scope-policy builder recovery claim
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Reconcile the preserved builder worktree and stale claim for the revisioned scope-policy authority task, then exercise the nested-sandbox recovery change in a fresh builder run. Resolve both current dead letters based on that outcome without discarding valid preserved work.
created_at: 2026-08-03T20:25:48.642Z
updated_at: 2026-08-04T04:52:03.453Z
---

## Problem

    Reconcile the preserved builder worktree and stale claim for the revisioned scope-policy authority task, then exercise the nested-sandbox recovery change in a fresh builder run. Resolve both current dead letters based on that outcome without discarding valid preserved work.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-03T18-00-00-128Z-progress-reviewer-eg0hk8.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-03T18-00-00-128Z-progress-reviewer-eg0hk8.

review verdict: needs-steering
review summary:

    Global scheduled review covering directory scope kota (scopeId 8nrg1m) for 2026-08-02T20:22:11.523Z–2026-08-03T20:22:11.523Z. Included 20 runs, 13 tasks, 0 events, 40 artifacts, 57 git entries, and 2 open dead letters. Task balance was Safety 9, Meta 4, Product 0, Platform 0. Safety work is concrete, but its central scope-policy task is held by a stale builder claim after two sandbox-related failures; a later recovery commit lacks a successful post-fix builder run. Excluded evidence includes 125 policy-pruned run payloads, runs and artifacts beyond truncation limits, portions of two large commits, and 65 lower-detail prompt references. Applied actions: no repository mutations or owner questions; one local recovery follow-up is proposed.

Evidence ids:

- scope:8nrg1m:task:task-add-revisioned-observable-scope-policy-authority
- scope:8nrg1m:run:2026-08-03T19-57-41-325Z-dispatcher-75ztja
- scope:8nrg1m:dead-letter:dlq-d02c2bcd-1bf3-4efc-aad8-83ec0158ddc1
- scope:8nrg1m:dead-letter:dlq-f8850033-6708-4c59-8dd6-36717e7f6cbc
- scope:8nrg1m:git:commit:811986419c00

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A fresh builder recovery run either lands the revisioned scope-policy authority task or releases/supersedes its claim with a durable disposition for preserved work; both cited dead letters have recorded final dispositions; the run no longer terminates with native_cli_sandbox_error; and dispatcher evidence no longer reports the task as an active stale recovery claim.

## Resolution Evidence

- `task-add-revisioned-observable-scope-policy-authority` is in `done/` with
  its focused 12-file, 173-test verification recorded.
- Builder run `2026-08-03T19-07-18-625Z-builder-nijy1h` completed the affected
  work and released its task claim. Dead letter
  `dlq-d02c2bcd-1bf3-4efc-aad8-83ec0158ddc1` records that run as its
  superseding disposition.
- The canonical `kota workflow dlq dismiss` command dismissed the duplicate
  `dlq-f8850033-6708-4c59-8dd6-36717e7f6cbc` on 2026-08-04 with the same
  successful builder run, completed task, and current dispatcher evidence as
  its rationale.
- Dispatcher run `2026-08-04T04-04-50-401Z-dispatcher-fsf6w5` reports
  `builderRecoveryCandidateCount: 0` and an empty
  `builderRecoveryRequested` list. The cited stale recovery claim is no longer
  active.
- The overlapping follow-up
  `task-reconcile-the-remediated-native-sandbox-builder-de` remains unchanged
  in `ready/` for a separately claimed run; this commit does not complete it.
- This fresh builder run exposed a narrower follow-on defect before staging:
  the bounded macOS native-CLI profile denied Git's required `/dev/null`
  descriptor sanitization. The profile now permits writes only to that inert
  device in addition to declared roots. Focused verification passed:
  `NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true --reporter=dot src/modules/execution/machine-authority-sandbox.test.ts -t "gives native CLIs bounded workspace writes"` (1 test passed).
  Broader verification also passed for the machine-authority sandbox and Codex
  adapter (2 files, 19 tests), and Biome reported no issues in the two changed
  source files.
