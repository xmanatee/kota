---
status: done
---

# Triage remaining open workflow dead letters

## Problem

Current open dead letters remain for a builder build timeout, a security-review investigate-candidates timeout, and an eval-harness-cadence missing claim-result metric. These ids are not resolved by the latest workflow-failure escalator run.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 1, Safety 1, Platform 1, Meta 0, Unclassified 6. Product and security work landed with no operator-journey risk, but the latest builder committed one task while holding another claim, failed only after commit, and the scope still has open dead letters.

Evidence ids:

- dead-letter:dlq-2cd9edfa-3573-4b28-9cfc-6c4d1ec3afb5
- dead-letter:dlq-0f0e22b8-2475-4f4f-89f3-4d90f79349b8
- dead-letter:dlq-bb5b609b-73e8-488e-a841-ed1a3e6a4852
- run:2026-06-28T12-52-30-292Z-workflow-failure-escalator-5exj71

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `dlq-2cd9edfa-3573-4b28-9cfc-6c4d1ec3afb5` was dismissed during builder run `2026-06-28T15-34-25-332Z-builder-8tnohl` after confirming the failed builder claimed `task-surface-worktree-run-status-and-cleanup-controls`, that task is now `done/` with acceptance evidence, commit `4995b65c` moved it to `done/`, and the stale active task claim was released with evidence.
- `dlq-0f0e22b8-2475-4f4f-89f3-4d90f79349b8` was dismissed during the same run after confirming it was superseded by successful security-review run `2026-06-28T12-17-50-568Z-security-review-wet7it`, which completed investigate/revalidate, created `task-security-review-the-approve-all-control-path-prefl`, and that task is now `done/` with focused approval-queue verification.
- `dlq-bb5b609b-73e8-488e-a841-ed1a3e6a4852` was dismissed during the same run as linked to existing blocked repair task `task-add-a-scientific-claim-reproduction-fixture-to-the`, whose operator-capture unblock precondition records the missing live `claim-result.json`/eval-pass artifact.
- Before/after diagnostics for all three cited DLQ items are exported under `.kota/runs/2026-06-28T15-34-25-332Z-builder-8tnohl/dlq-*-before.json` and `.kota/runs/2026-06-28T15-34-25-332Z-builder-8tnohl/dlq-*-after.json`.
- Refreshed report: `pnpm kota workflow dlq list --status open --limit 20` returned `open=0 dismissed=60 redriven=1` and no open items.
