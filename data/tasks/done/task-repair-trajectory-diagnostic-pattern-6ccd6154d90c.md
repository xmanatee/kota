---
id: task-repair-trajectory-diagnostic-pattern-6ccd6154d90c
title: Repair recurring explorer trajectory diagnostic
status: done
priority: p2
area: autonomy
summary: Fix the recurring unsupported_trajectory trajectory warning in explorer/explore.
created_at: 2026-05-29T05:54:10.782Z
updated_at: 2026-05-29T06:30:00.000Z
---

## Problem

Recent successful workflow runs are repeatedly emitting the same
trajectory-diagnostic warning. A single advisory warning can be local
noise; this pattern crossed the configured recurrence threshold and should
be repaired as normal task work.

Pattern fingerprint: `trajectory-diagnostic:explorer:explore:unsupported_trajectory:29e0ec93e82e`
Evidence fingerprint: `46fff4483c04db6581c9769eebe9b5acc5e1a9c368ec7bfe1300b771d25cf80e`

## Diagnostic Evidence

- Warning codes: unsupported_trajectory
- Affected workflow/step: explorer/explore
- Detail fingerprint: 29e0ec93e82e
- Run ids: 2026-05-26T04-16-16-320Z-explorer-bczspz, 2026-05-26T04-47-51-544Z-explorer-w8753v, 2026-05-26T05-41-00-044Z-explorer-pvetla, 2026-05-26T06-50-30-067Z-explorer-gia3us, 2026-05-26T07-24-18-113Z-explorer-mbeone, 2026-05-26T11-27-14-695Z-explorer-qaxrlr, 2026-05-26T12-57-58-739Z-explorer-pt6h8c, 2026-05-26T14-54-54-291Z-explorer-wah622, 2026-05-26T15-51-41-369Z-explorer-z8oxnq, 2026-05-26T18-31-01-762Z-explorer-gbpjbu, 2026-05-26T19-24-46-370Z-explorer-fzwkqj, 2026-05-26T20-45-51-721Z-explorer-fywb7y, 2026-05-26T21-33-41-783Z-explorer-ec1c9r, 2026-05-26T22-08-37-327Z-explorer-04vocl, 2026-05-26T22-47-54-757Z-explorer-0sknqa, 2026-05-27T00-05-22-607Z-explorer-2bsxs0, 2026-05-27T00-42-16-707Z-explorer-h3yddz, 2026-05-27T01-25-42-685Z-explorer-1fr8i6, 2026-05-27T02-18-56-126Z-explorer-5v2c1h, 2026-05-27T03-03-14-996Z-explorer-e803yb, 2026-05-27T03-36-08-472Z-explorer-8s70vy, 2026-05-27T05-05-31-742Z-explorer-v7z6mf, 2026-05-27T05-39-59-854Z-explorer-t5z7kq, 2026-05-27T07-29-36-209Z-explorer-yhyup3, 2026-05-27T08-10-22-693Z-explorer-zfupdd, 2026-05-27T08-45-55-115Z-explorer-fnh89a, 2026-05-27T09-19-57-836Z-explorer-zwx8f9, 2026-05-27T10-07-34-326Z-explorer-h32edl, 2026-05-27T10-51-55-406Z-explorer-ygd6s4, 2026-05-27T11-28-55-916Z-explorer-u6eaia, 2026-05-27T12-06-39-206Z-explorer-ulhooh, 2026-05-27T12-51-32-535Z-explorer-p0vfs9, 2026-05-27T15-24-06-220Z-explorer-ykdf7n, 2026-05-27T16-52-49-489Z-explorer-hbi7q6, 2026-05-27T17-59-22-579Z-explorer-zonb9h, 2026-05-27T18-37-30-139Z-explorer-od4ga3, 2026-05-27T19-10-32-115Z-explorer-wb9eya, 2026-05-27T23-03-36-696Z-explorer-u2pj9s, 2026-05-27T23-40-10-243Z-explorer-jl2qih, 2026-05-28T00-12-11-277Z-explorer-3ic2u3, 2026-05-28T01-01-02-359Z-explorer-s0cu2t, 2026-05-28T01-35-03-908Z-explorer-57klhq, 2026-05-28T02-10-23-101Z-explorer-22kw41, 2026-05-28T02-44-24-147Z-explorer-0jdt0w, 2026-05-28T03-19-08-401Z-explorer-u2y02y, 2026-05-28T04-33-15-824Z-explorer-m2kpzn, 2026-05-28T13-38-47-755Z-explorer-95l2vo, 2026-05-28T15-11-26-446Z-explorer-hwrlbe, 2026-05-28T22-46-54-044Z-explorer-i0hyr8, 2026-05-29T01-33-31-383Z-explorer-tzf3gm, 2026-05-29T02-09-22-037Z-explorer-61seon, 2026-05-29T02-42-52-572Z-explorer-ved6b7, 2026-05-29T03-26-07-593Z-explorer-g5ed0n, 2026-05-29T04-04-25-304Z-explorer-aw7h5x, 2026-05-29T04-47-27-740Z-explorer-qfoz2e, 2026-05-29T05-20-58-262Z-explorer-km9jh8
- Window: 2026-05-26T04:17:47.917Z to 2026-05-29T05:24:41.465Z
- Active reason: explorer/explore emitted unsupported_trajectory in 56 recent successful workflow run artifacts.
- Summary: Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.

Evidence artifacts:

- .kota/runs/2026-05-26T04-16-16-320Z-explorer-bczspz/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T04-47-51-544Z-explorer-w8753v/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T05-41-00-044Z-explorer-pvetla/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T06-50-30-067Z-explorer-gia3us/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T07-24-18-113Z-explorer-mbeone/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T11-27-14-695Z-explorer-qaxrlr/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T12-57-58-739Z-explorer-pt6h8c/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T14-54-54-291Z-explorer-wah622/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T15-51-41-369Z-explorer-z8oxnq/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T18-31-01-762Z-explorer-gbpjbu/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T19-24-46-370Z-explorer-fzwkqj/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T20-45-51-721Z-explorer-fywb7y/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T21-33-41-783Z-explorer-ec1c9r/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T22-08-37-327Z-explorer-04vocl/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-26T22-47-54-757Z-explorer-0sknqa/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T00-05-22-607Z-explorer-2bsxs0/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T00-42-16-707Z-explorer-h3yddz/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T01-25-42-685Z-explorer-1fr8i6/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T02-18-56-126Z-explorer-5v2c1h/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T03-03-14-996Z-explorer-e803yb/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T03-36-08-472Z-explorer-8s70vy/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T05-05-31-742Z-explorer-v7z6mf/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T05-39-59-854Z-explorer-t5z7kq/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T07-29-36-209Z-explorer-yhyup3/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T08-10-22-693Z-explorer-zfupdd/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T08-45-55-115Z-explorer-fnh89a/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T09-19-57-836Z-explorer-zwx8f9/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-07-34-326Z-explorer-h32edl/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-51-55-406Z-explorer-ygd6s4/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T11-28-55-916Z-explorer-u6eaia/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T12-06-39-206Z-explorer-ulhooh/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T12-51-32-535Z-explorer-p0vfs9/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T15-24-06-220Z-explorer-ykdf7n/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T16-52-49-489Z-explorer-hbi7q6/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T17-59-22-579Z-explorer-zonb9h/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T18-37-30-139Z-explorer-od4ga3/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T19-10-32-115Z-explorer-wb9eya/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T23-03-36-696Z-explorer-u2pj9s/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-27T23-40-10-243Z-explorer-jl2qih/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T00-12-11-277Z-explorer-3ic2u3/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T01-01-02-359Z-explorer-s0cu2t/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T01-35-03-908Z-explorer-57klhq/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T02-10-23-101Z-explorer-22kw41/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T02-44-24-147Z-explorer-0jdt0w/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T03-19-08-401Z-explorer-u2y02y/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T04-33-15-824Z-explorer-m2kpzn/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T13-38-47-755Z-explorer-95l2vo/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T15-11-26-446Z-explorer-hwrlbe/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-28T22-46-54-044Z-explorer-i0hyr8/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T01-33-31-383Z-explorer-tzf3gm/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T02-09-22-037Z-explorer-61seon/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T02-42-52-572Z-explorer-ved6b7/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T03-26-07-593Z-explorer-g5ed0n/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T04-04-25-304Z-explorer-aw7h5x/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T04-47-27-740Z-explorer-qfoz2e/steps/explore.trajectory-diagnostics.json
- .kota/runs/2026-05-29T05-20-58-262Z-explorer-km9jh8/steps/explore.trajectory-diagnostics.json

Bounded diagnostic details:

- capability.emitsAgentMessageStream=false

## Desired Outcome

Repair the workflow, prompt, validation, harness, or verification behavior
so fresh successful run artifacts no longer emit this pattern fingerprint.
Keep the typed diagnostic signal intact unless the detector itself is
miscalibrated and the adjustment is covered by focused tests.

## Constraints

- Use existing trajectory-diagnostics artifacts as evidence.
- Do not scrape raw event streams, prompts, secrets, or full tool outputs.
- Do not create one task per run; keep this task anchored to the stable
  pattern fingerprint above.
- Keep operator-only cost and report ranking out of autonomy-agent prompts.

## Done When

- Fresh run artifacts no longer trigger this trajectory-diagnostic pattern,
  or the threshold/fingerprint behavior is deliberately adjusted with tests.
- Focused tests cover the local cause and the detector behavior that would
  have caught this recurrence.
- Operator-facing report or attention output still names future active
  trajectory-diagnostic patterns and repair task ids.

## Source / Intent

Auto-created by `trajectory-diagnostic-escalator` from recent workflow
agent-step trajectory-diagnostics artifacts. Repeated successful-run
process-quality warnings should become reviewable repair work instead of
remaining manual artifact archaeology.

## Initiative

Outcome-grade autonomy evaluation: successful workflow runs should remain
inspectable and repairable when process-quality evidence shows repeated
weak success patterns.

## Acceptance Evidence

- Test output for the repaired workflow, prompt, harness, or validation path.
- Detector test or run artifact showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Operator-facing report or attention fixture showing future escalations
  include the repair task id without cost fields.

## Completion Evidence

- Detector repair: `unsupported_trajectory` is treated as a harness capability
  boundary and is not escalated as workflow-repairable process-quality debt.
- Focused tests: `pnpm test src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/report/aggregate.test.ts src/modules/autonomy/report/render.test.ts src/modules/autonomy/workflows/trajectory-diagnostic-escalator/workflow.test.ts src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts`
  passed 5 files / 40 tests.
- Run evidence: `.kota/runs/2026-05-29T06-05-39-045Z-builder-ej9dyf/explorer-trajectory-escalation-evidence.json`
  records the target fingerprint inactive, and
  `.kota/runs/2026-05-29T06-05-39-045Z-builder-ej9dyf/trajectory-attention-fixture.json`
  records a repair-task-id attention item with no cost or throughput fields.

<!-- trajectory-diagnostic-pattern-fingerprint: trajectory-diagnostic:explorer:explore:unsupported_trajectory:29e0ec93e82e -->
<!-- trajectory-diagnostic-evidence-fingerprint: 46fff4483c04db6581c9769eebe9b5acc5e1a9c368ec7bfe1300b771d25cf80e -->
