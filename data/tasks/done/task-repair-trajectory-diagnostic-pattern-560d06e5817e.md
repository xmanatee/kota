---
id: task-repair-trajectory-diagnostic-pattern-560d06e5817e
title: Repair recurring improver trajectory diagnostic
status: done
priority: p2
area: autonomy
summary: Fix the recurring unsupported_trajectory trajectory warning in improver/improve.
created_at: 2026-05-29T05:54:10.845Z
updated_at: 2026-05-29T06:53:47.213Z
---

## Problem

Recent successful workflow runs are repeatedly emitting the same
trajectory-diagnostic warning. A single advisory warning can be local
noise; this pattern crossed the configured recurrence threshold and should
be repaired as normal task work.

Pattern fingerprint: `trajectory-diagnostic:improver:improve:unsupported_trajectory:29e0ec93e82e`
Evidence fingerprint: `5be294a4140a2387f32d94fb35bb88352b30ad91172a097afa79709fc6e6f4cd`

## Diagnostic Evidence

- Warning codes: unsupported_trajectory
- Affected workflow/step: improver/improve
- Detail fingerprint: 29e0ec93e82e
- Run ids: 2026-05-26T21-41-12-848Z-improver-2xe9jb, 2026-05-27T00-08-07-494Z-improver-urj83p, 2026-05-28T13-41-38-342Z-improver-40y36f
- Window: 2026-05-26T21:55:15.635Z to 2026-05-28T13:47:08.626Z
- Active reason: improver/improve emitted unsupported_trajectory in 3 recent successful workflow run artifacts.
- Summary: Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.

Evidence artifacts:

- .kota/runs/2026-05-26T21-41-12-848Z-improver-2xe9jb/steps/improve.trajectory-diagnostics.json
- .kota/runs/2026-05-27T00-08-07-494Z-improver-urj83p/steps/improve.trajectory-diagnostics.json
- .kota/runs/2026-05-28T13-41-38-342Z-improver-40y36f/steps/improve.trajectory-diagnostics.json

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

- `src/modules/autonomy/trajectory-diagnostic-escalation.test.ts` now locks
  repeated `improver/improve` `unsupported_trajectory` artifacts below the
  escalation gate, matching the recorded fingerprint for this task.
- `node --conditions=source --import tsx -e ...detectRecurringTrajectoryDiagnosticPatterns(".kota/runs", { nowMs: Date.parse("2026-05-29T06:52:30.000Z") })`
  returned `[]` for the current run artifacts, so the recorded
  `improver/improve` unsupported trajectory fingerprint no longer crosses the
  active pattern gate.
- `pnpm test src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/report/aggregate.test.ts src/modules/autonomy/report/render.test.ts`
  passed on 2026-05-29 with 3 files and 31 tests. The suite covers
  unsupported capability-boundary artifacts, supported warning recurrence,
  report aggregation of future repair task ids, and report rendering without
  cost fields in the trajectory-diagnostics section.
- `pnpm kota report --json` on 2026-05-29 reported
  `trajectoryDiagnostics.activePatterns: []`.

<!-- trajectory-diagnostic-pattern-fingerprint: trajectory-diagnostic:improver:improve:unsupported_trajectory:29e0ec93e82e -->
<!-- trajectory-diagnostic-evidence-fingerprint: 5be294a4140a2387f32d94fb35bb88352b30ad91172a097afa79709fc6e6f4cd -->
