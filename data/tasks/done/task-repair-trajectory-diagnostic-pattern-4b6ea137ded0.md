---
id: task-repair-trajectory-diagnostic-pattern-4b6ea137ded0
title: Repair recurring builder trajectory diagnostic
status: done
priority: p2
area: autonomy
summary: Fix the recurring unsupported_trajectory trajectory warning in builder/build.
created_at: 2026-05-29T05:54:10.761Z
updated_at: 2026-05-29T05:58:58.000Z
---

## Problem

Recent successful workflow runs are repeatedly emitting the same
trajectory-diagnostic warning. A single advisory warning can be local
noise; this pattern crossed the configured recurrence threshold and should
be repaired as normal task work.

Pattern fingerprint: `trajectory-diagnostic:builder:build:unsupported_trajectory:29e0ec93e82e`
Evidence fingerprint: `5daa8d28cf621a183b55a8c3c196e7ef2fdc11c850a30c2a44b13cdd0384427f`

## Diagnostic Evidence

- Warning codes: unsupported_trajectory
- Affected workflow/step: builder/build
- Detail fingerprint: 29e0ec93e82e
- Run ids: 2026-05-26T04-17-55-340Z-builder-lcyzbz, 2026-05-26T04-51-52-278Z-builder-vdw5ve, 2026-05-26T05-48-30-948Z-builder-char3h, 2026-05-26T06-54-32-235Z-builder-e1a6wa, 2026-05-26T10-39-14-295Z-builder-unzqkb, 2026-05-26T13-53-19-740Z-builder-4xdjex, 2026-05-26T14-59-51-945Z-builder-z6tasr, 2026-05-26T15-10-44-472Z-builder-dnoseo, 2026-05-26T15-26-03-651Z-builder-pnvy1x, 2026-05-26T15-56-42-396Z-builder-4bn2a0, 2026-05-26T18-37-03-222Z-builder-encgak, 2026-05-26T19-29-17-202Z-builder-9ao2vd, 2026-05-26T19-58-52-160Z-builder-stwru9, 2026-05-26T20-52-22-905Z-builder-kqff34, 2026-05-26T21-05-09-277Z-builder-pant8u, 2026-05-26T21-55-18-920Z-builder-433ic3, 2026-05-26T22-14-08-214Z-builder-k0ud3b, 2026-05-26T22-52-31-774Z-builder-mjfyad, 2026-05-26T23-49-44-205Z-builder-g7ms0i, 2026-05-27T00-16-43-055Z-builder-8b1mx7, 2026-05-27T00-46-47-879Z-builder-biiy3r, 2026-05-27T01-13-48-502Z-builder-21c1xt, 2026-05-27T01-31-43-962Z-builder-whyolf, 2026-05-27T02-25-26-981Z-builder-i011sk, 2026-05-27T03-06-18-406Z-builder-vurngz, 2026-05-27T03-20-00-106Z-builder-pjfk0t, 2026-05-27T03-41-39-611Z-builder-84l0x4, 2026-05-27T05-10-02-793Z-builder-ibkz1i, 2026-05-27T05-44-30-913Z-builder-inleza, 2026-05-27T07-36-07-584Z-builder-v2alwu, 2026-05-27T08-00-21-618Z-builder-s9zimt, 2026-05-27T08-15-53-541Z-builder-ad3yfx, 2026-05-27T09-25-59-030Z-builder-u9kg4k, 2026-05-27T10-12-48-141Z-builder-sqexwb, 2026-05-27T10-36-06-847Z-builder-f4upr0, 2026-05-27T10-58-56-466Z-builder-om2t7r, 2026-05-27T11-36-40-156Z-builder-bkgrb4, 2026-05-27T12-14-13-344Z-builder-znxsmm, 2026-05-27T15-04-22-732Z-builder-w35b4v, 2026-05-27T15-30-07-269Z-builder-5av2hq, 2026-05-27T18-07-36-755Z-builder-3j23nw, 2026-05-27T22-32-46-755Z-builder-oa3dq8, 2026-05-27T23-09-07-949Z-builder-b0o8nh, 2026-05-27T23-42-12-745Z-builder-0g8cjr, 2026-05-28T00-17-41-884Z-builder-mzgzz3, 2026-05-28T01-40-04-758Z-builder-6axr8p, 2026-05-28T02-48-54-884Z-builder-wk55jq, 2026-05-28T03-23-39-026Z-builder-h7pic0, 2026-05-28T13-47-11-743Z-builder-thyg3e, 2026-05-28T15-16-27-423Z-builder-wfldiy, 2026-05-29T00-05-36-321Z-builder-1h4a28, 2026-05-29T01-24-05-888Z-builder-z361wo, 2026-05-29T01-39-32-352Z-builder-p25wja, 2026-05-29T01-50-05-123Z-builder-djv073, 2026-05-29T02-51-53-432Z-builder-kajkru, 2026-05-29T03-28-06-803Z-builder-cr4jmw, 2026-05-29T04-09-26-379Z-builder-sbdphx, 2026-05-29T04-37-29-408Z-builder-rt8ye2, 2026-05-29T05-24-58-960Z-builder-6lhcsl
- Window: 2026-05-26T04:33:19.017Z to 2026-05-29T05:47:19.931Z
- Active reason: builder/build emitted unsupported_trajectory in 59 recent successful workflow run artifacts.
- Summary: Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.

Evidence artifacts:

- .kota/runs/2026-05-26T04-17-55-340Z-builder-lcyzbz/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T04-51-52-278Z-builder-vdw5ve/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T06-54-32-235Z-builder-e1a6wa/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T10-39-14-295Z-builder-unzqkb/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T13-53-19-740Z-builder-4xdjex/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T14-59-51-945Z-builder-z6tasr/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T15-10-44-472Z-builder-dnoseo/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T15-26-03-651Z-builder-pnvy1x/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T15-56-42-396Z-builder-4bn2a0/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T18-37-03-222Z-builder-encgak/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T19-29-17-202Z-builder-9ao2vd/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T19-58-52-160Z-builder-stwru9/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T20-52-22-905Z-builder-kqff34/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T21-05-09-277Z-builder-pant8u/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T21-55-18-920Z-builder-433ic3/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T22-14-08-214Z-builder-k0ud3b/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T22-52-31-774Z-builder-mjfyad/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-26T23-49-44-205Z-builder-g7ms0i/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T00-16-43-055Z-builder-8b1mx7/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T00-46-47-879Z-builder-biiy3r/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T01-13-48-502Z-builder-21c1xt/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T01-31-43-962Z-builder-whyolf/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T02-25-26-981Z-builder-i011sk/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T03-06-18-406Z-builder-vurngz/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T03-20-00-106Z-builder-pjfk0t/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T03-41-39-611Z-builder-84l0x4/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T05-10-02-793Z-builder-ibkz1i/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T05-44-30-913Z-builder-inleza/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T07-36-07-584Z-builder-v2alwu/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T08-00-21-618Z-builder-s9zimt/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T08-15-53-541Z-builder-ad3yfx/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T09-25-59-030Z-builder-u9kg4k/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-12-48-141Z-builder-sqexwb/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-36-06-847Z-builder-f4upr0/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T10-58-56-466Z-builder-om2t7r/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T11-36-40-156Z-builder-bkgrb4/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T12-14-13-344Z-builder-znxsmm/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T15-04-22-732Z-builder-w35b4v/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T15-30-07-269Z-builder-5av2hq/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T18-07-36-755Z-builder-3j23nw/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T22-32-46-755Z-builder-oa3dq8/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T23-09-07-949Z-builder-b0o8nh/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-27T23-42-12-745Z-builder-0g8cjr/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T00-17-41-884Z-builder-mzgzz3/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T01-40-04-758Z-builder-6axr8p/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T02-48-54-884Z-builder-wk55jq/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T03-23-39-026Z-builder-h7pic0/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T13-47-11-743Z-builder-thyg3e/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-28T15-16-27-423Z-builder-wfldiy/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T00-05-36-321Z-builder-1h4a28/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T01-24-05-888Z-builder-z361wo/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T01-39-32-352Z-builder-p25wja/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T01-50-05-123Z-builder-djv073/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T02-51-53-432Z-builder-kajkru/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T03-28-06-803Z-builder-cr4jmw/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T04-09-26-379Z-builder-sbdphx/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T04-37-29-408Z-builder-rt8ye2/steps/build.trajectory-diagnostics.json
- .kota/runs/2026-05-29T05-24-58-960Z-builder-6lhcsl/steps/build.trajectory-diagnostics.json

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

<!-- trajectory-diagnostic-pattern-fingerprint: trajectory-diagnostic:builder:build:unsupported_trajectory:29e0ec93e82e -->
<!-- trajectory-diagnostic-evidence-fingerprint: 5daa8d28cf621a183b55a8c3c196e7ef2fdc11c850a30c2a44b13cdd0384427f -->
