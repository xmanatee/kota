---
status: done
---

# Escalate recurring thin review acceptances into repair tasks

## Problem

KOTA now records deterministic review-scrutiny metrics for critic,
progress-reviewer, semantic-gate, and PR-reviewer artifacts. That closes the
first observability gap, but the signal is still report-only. A run window can
contain many approval-like reviewer decisions with little visible evidence,
warnings, cited files, or follow-up work, and the autonomous queue will not
open a repair task unless a human notices the report.

The current 7-day operator report makes this concrete: 347 total reviews, 265
approval-like decisions, and 161 thin acceptances. The strongest concentration
is on reviewer surfaces that guard task completion (`critic`: 128 thin
acceptances out of 140 approval-like decisions; `semantic-gate`: 13 out of 15).
Some thin approvals may be valid, but repeated concentration is exactly the
habituation shape the diagnostic was added to expose. Leaving it only in the
report makes it too easy for review quality drift to become background noise.

## Desired Outcome

Add a paced, deterministic review-scrutiny escalation path. When recent
review-scrutiny records show a recurring thin-acceptance pattern that crosses a
conservative threshold, KOTA opens or refreshes one evidence-backed repair task
instead of generating per-run churn or silently relying on the operator report.

The escalation should make the pattern actionable without treating every thin
acceptance as a failed review:

- group repeated thin acceptances by reviewer surface and useful local context
  such as workflow, task area, or task class where available;
- require enough observations and a high enough thin-acceptance ratio before
  opening work;
- cite concrete run ids, task ids, reviewer surface, decision, artifact path,
  and observed/absent metrics in the generated task body or escalation
  artifact;
- refresh an existing same-pattern task instead of creating duplicates; and
- keep the operator report diagnostic visible even when no pattern crosses the
  escalation gate.

## Constraints

- Build on the existing review-scrutiny records and report aggregation. Do not
  add a second reviewer, LLM judge, prompt-only rule, hidden reasoning trace, or
  spreadsheet-like audit store.
- This is a paced escalation, not an automatic blocker for individual runs.
  A single concise valid approval must remain possible.
- Do not create one task per thin acceptance. Use stable fingerprints and
  cooldown/idempotency comparable to the existing workflow-failure and
  trajectory-diagnostic escalators.
- Treat absent metrics and unsupported legacy artifacts as context, not as
  proof of poor review by themselves.
- Generated repair tasks must stay evidence-backed and actionable. If the only
  action is "inspect old run artifacts manually", the gate is too broad.
- Keep cost fields out of autonomy-facing outputs.

## Done When

- A module-owned detector can read recent review-scrutiny records and classify
  recurring thin-acceptance patterns with explicit minimum sample and ratio
  thresholds.
- The detector opens or refreshes one normalized repair task for a qualifying
  pattern, with stable fingerprinting, cooldown, and cited run/artifact/task
  evidence.
- Non-qualifying windows produce a durable no-op/escalation artifact or report
  detail explaining why no task was opened.
- The operator report or existing autonomy report JSON shows which
  thin-acceptance patterns are active, suppressed by cooldown, or below
  threshold.
- Focused tests cover: below-threshold no-op, above-threshold escalation,
  idempotent refresh, unsupported/absent-metric handling, and no task churn for
  isolated thin approvals.
- Existing review-scrutiny parser/report tests and autonomy escalator tests
  remain green.

## Source / Intent

Explorer run `2026-06-23T20-46-18-772Z-explorer-tgnd1e` reviewed a thin queue
with `strategicReadyCoverageGap: true`. The surfaced strategic blocked tasks
were still waiting on operator-captured artifacts and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

Local evidence from `node bin/kota.mjs report --days 7 --json` on this run:

- `reviewScrutiny.totalReviews`: 347
- `reviewScrutiny.approvalLikeDecisions`: 265
- `reviewScrutiny.thinAcceptances`: 161
- `critic`: 128 thin acceptances out of 140 approval-like decisions
- `semantic-gate`: 13 thin acceptances out of 15 approval-like decisions
- recent refs include
  `2026-06-23T20-18-03-413Z-builder-2322qt`,
  `2026-06-23T19-47-15-526Z-builder-et00ya`, and
  `2026-06-23T19-26-50-632Z-builder-dy0p5t`

External source already recorded in the watchlist:

- `https://arxiv.org/abs/2606.22721` ("Habituation at the Gate: Rising
  Approval and Declining Scrutiny in Human Review of AI Agent Code") motivated
  the completed `task-record-autonomy-review-scrutiny-metrics`. That task
  deliberately made `thinAcceptance` diagnostic rather than blocking. This
  follow-up turns repeated local diagnostic evidence into paced repair work.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Meta task supports the Product claim that KOTA's autonomous work can be
trusted from run artifacts, and the Safety concern that agent-authored code
should not be silently accepted as reviewer workload or habituation rises.

## Acceptance Evidence

- Diff adds `review-scrutiny-escalator`, review-scrutiny escalation detector,
  stable task fingerprint/cooldown handling, repair-task create/refresh/apply
  paths, attention digest output, and report JSON/text exposure for active,
  cooldown-suppressed, and below-threshold patterns.
- Focused transcript: `pnpm exec vitest run src/modules/autonomy/review-scrutiny-escalation.test.ts src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts src/modules/autonomy/report/render-review-scrutiny.test.ts src/modules/autonomy/report/render.test.ts src/modules/autonomy/report/aggregate.test.ts src/modules/autonomy/review-scrutiny.test.ts src/modules/autonomy/workflow-failure-escalation.test.ts src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/workflows/workflow-failure-escalator/workflow.test.ts src/modules/autonomy/workflows/trajectory-diagnostic-escalator/workflow.test.ts src/modules/autonomy/report/report-cli.test.ts` passes: 11 files, 75 tests.
- Source-mode report artifact: `.kota/runs/2026-06-23T22-11-40-419Z-builder-dprtdy/report.json` shows `reviewScrutinyEscalation` with active=5, cooldown=0, below=5 for the current 7-day window.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run hygiene` pass.
- `pnpm run validate-tasks` reaches the expected task-state staging checks but
  cannot pass in this sandbox because `.git/index.lock` cannot be created;
  both `pnpm kota task move ... doing` and `pnpm kota task move ... done`
  failed with that same git-index permission error before the equivalent task
  file transitions were applied manually.
