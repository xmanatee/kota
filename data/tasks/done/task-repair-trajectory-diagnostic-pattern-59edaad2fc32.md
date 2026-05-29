---
id: task-repair-trajectory-diagnostic-pattern-59edaad2fc32
title: Repair recurring security-review trajectory diagnostic
status: done
priority: p2
area: autonomy
summary: Fix the recurring unsupported_trajectory trajectory warning in security-review/investigate-candidates.
created_at: 2026-05-29T05:54:10.802Z
updated_at: 2026-05-29T06:27:53.000Z
---

## Problem

Recent successful workflow runs are repeatedly emitting the same
trajectory-diagnostic warning. A single advisory warning can be local
noise; this pattern crossed the configured recurrence threshold and should
be repaired as normal task work.

Pattern fingerprint: `trajectory-diagnostic:security-review:investigate-candidates:unsupported_trajectory:29e0ec93e82e`
Evidence fingerprint: `73691ab439ff82b0ed0a5070848637206b6be345be09665be29404d9d7bd7367`

## Diagnostic Evidence

- Warning codes: unsupported_trajectory
- Affected workflow/step: security-review/investigate-candidates
- Detail fingerprint: 29e0ec93e82e
- Run ids: 2026-05-26T04-09-25-215Z-security-review-yrxk0m, 2026-05-26T06-42-31-313Z-security-review-ftbb9c, 2026-05-26T11-39-15-012Z-security-review-0ene6i, 2026-05-26T14-44-50-830Z-security-review-24xa9w, 2026-05-26T18-26-31-849Z-security-review-pjxy6t, 2026-05-26T19-49-22-030Z-security-review-h4k45s, 2026-05-26T22-42-30-144Z-security-review-brqdwt, 2026-05-27T01-05-47-574Z-security-review-7dcilz, 2026-05-27T02-52-17-351Z-security-review-mykpa4, 2026-05-27T05-31-29-258Z-security-review-cj48hv, 2026-05-27T07-54-20-594Z-security-review-fekkff, 2026-05-27T10-01-16-684Z-security-review-0txbhp, 2026-05-27T11-22-09-727Z-security-review-2wwcqm, 2026-05-27T12-43-57-959Z-security-review-84ijn1, 2026-05-27T17-53-05-422Z-security-review-4nor04, 2026-05-27T23-32-41-822Z-security-review-etsxa5, 2026-05-28T01-05-03-211Z-security-review-foitpk, 2026-05-28T02-14-23-579Z-security-review-7jleay, 2026-05-28T04-27-28-829Z-security-review-iv8gk9, 2026-05-28T13-34-36-501Z-security-review-284im2, 2026-05-28T23-56-36-287Z-security-review-09pmyn, 2026-05-29T01-16-37-722Z-security-review-52hfaq, 2026-05-29T03-17-35-099Z-security-review-nu2xgs, 2026-05-29T04-27-59-111Z-security-review-739zbl, 2026-05-29T05-47-54-021Z-security-review-w9g6zs
- Window: 2026-05-26T04:16:16.088Z to 2026-05-29T05:54:08.815Z
- Active reason: security-review/investigate-candidates emitted unsupported_trajectory in 25 recent successful workflow run artifacts.
- Summary: Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.

Evidence artifacts:

- .kota/runs/2026-05-26T04-09-25-215Z-security-review-yrxk0m/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T06-42-31-313Z-security-review-ftbb9c/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T11-39-15-012Z-security-review-0ene6i/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T14-44-50-830Z-security-review-24xa9w/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T18-26-31-849Z-security-review-pjxy6t/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T19-49-22-030Z-security-review-h4k45s/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-26T22-42-30-144Z-security-review-brqdwt/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T01-05-47-574Z-security-review-7dcilz/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T02-52-17-351Z-security-review-mykpa4/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T05-31-29-258Z-security-review-cj48hv/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T07-54-20-594Z-security-review-fekkff/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-01-16-684Z-security-review-0txbhp/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T11-22-09-727Z-security-review-2wwcqm/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T12-43-57-959Z-security-review-84ijn1/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T17-53-05-422Z-security-review-4nor04/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-27T23-32-41-822Z-security-review-etsxa5/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-28T01-05-03-211Z-security-review-foitpk/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-28T02-14-23-579Z-security-review-7jleay/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-28T04-27-28-829Z-security-review-iv8gk9/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-28T13-34-36-501Z-security-review-284im2/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-28T23-56-36-287Z-security-review-09pmyn/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-29T01-16-37-722Z-security-review-52hfaq/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-29T03-17-35-099Z-security-review-nu2xgs/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-29T04-27-59-111Z-security-review-739zbl/steps/investigate-candidates.trajectory-diagnostics.json
- .kota/runs/2026-05-29T05-47-54-021Z-security-review-w9g6zs/steps/investigate-candidates.trajectory-diagnostics.json

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

- `src/modules/autonomy/trajectory-diagnostic-escalation.ts` treats
  unsupported trajectory artifacts and `unsupported_trajectory` diagnostics as
  non-escalatable capability-boundary evidence, while leaving supported
  process-quality diagnostics escalatable.
- `pnpm test src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/report/render.test.ts`
  passed on 2026-05-29 with 14 tests. The focused tests cover repeated
  unsupported harness artifacts, unsupported codes in otherwise supported
  artifacts, supported warning recurrence, and report rendering of future
  repair task ids without cost fields.
- `pnpm kota report --json` on 2026-05-29 reported
  `trajectoryDiagnostics.activePatterns: []`, so the recorded
  security-review/investigate-candidates unsupported trajectory fingerprint no
  longer crosses the operator report gate.

<!-- trajectory-diagnostic-pattern-fingerprint: trajectory-diagnostic:security-review:investigate-candidates:unsupported_trajectory:29e0ec93e82e -->
<!-- trajectory-diagnostic-evidence-fingerprint: 73691ab439ff82b0ed0a5070848637206b6be345be09665be29404d9d7bd7367 -->
