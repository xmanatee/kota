---
id: task-repair-workflow-failure-pattern-a3bd654a8f4c
title: Repair persistent trajectory-diagnostic-escalator workflow failure pattern
status: done
priority: p1
area: autonomy
summary: Fix the local cause behind trajectory-diagnostic-escalator's persistent consecutive failure signal (step inspect-patterns error f8e7bfd65856).
created_at: 2026-06-22T13:24:46.650Z
updated_at: 2026-06-22T14:03:31Z
task_class: Meta
---

## Problem

The `trajectory-diagnostic-escalator` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:trajectory-diagnostic-escalator:step-error:e7feb8f277b6`
Root-cause fingerprint: `workflow-failure-root:trajectory-diagnostic-escalator:543ed98e7816`
Evidence fingerprint: `57847f4a2c1e5ad3ca2b2f4de353555ca370eacff310aa2cdaa35325e655d651`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: trajectory-diagnostic-escalator
- Failure class: step-error:inspect-patterns:f8e7bfd65856
- Signal: step inspect-patterns error f8e7bfd65856
- Run ids: 2026-06-22T13-02-54-631Z-trajectory-diagnostic-escalator-b8u03i, 2026-06-22T13-06-24-493Z-trajectory-diagnostic-escalator-titk3p, 2026-06-22T13-16-10-782Z-trajectory-diagnostic-escalator-v9yy12, 2026-06-22T13-24-41-866Z-trajectory-diagnostic-escalator-ejnmjx, 2026-06-22T13-28-20-894Z-trajectory-diagnostic-escalator-4n57a8, 2026-06-22T13-28-36-658Z-trajectory-diagnostic-escalator-jo0zyn, 2026-06-22T13-28-42-847Z-trajectory-diagnostic-escalator-udw4ce, 2026-06-22T13-28-57-193Z-trajectory-diagnostic-escalator-j6q8w1, 2026-06-22T13-29-05-952Z-trajectory-diagnostic-escalator-rphff8
- Window: 2026-06-22T13:02:59.683Z to 2026-06-22T13:29:07.149Z
- Actionable reason: trajectory-diagnostic-escalator has 9 consecutive failed completed runs with the same owned failure class (step inspect-patterns error f8e7bfd65856).

- run 2026-06-22T13-29-05-952Z-trajectory-diagnostic-escalator-rphff8 failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-28-57-193Z-trajectory-diagnostic-escalator-j6q8w1 failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-28-42-847Z-trajectory-diagnostic-escalator-udw4ce failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-28-36-658Z-trajectory-diagnostic-escalator-jo0zyn failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-28-20-894Z-trajectory-diagnostic-escalator-4n57a8 failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-24-41-866Z-trajectory-diagnostic-escalator-ejnmjx failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-16-10-782Z-trajectory-diagnostic-escalator-v9yy12 failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-06-24-493Z-trajectory-diagnostic-escalator-titk3p failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json
- run 2026-06-22T13-02-54-631Z-trajectory-diagnostic-escalator-b8u03i failed at step inspect-patterns: Malformed trajectory diagnostics artifact: /Users/xmanatee/Desktop/mono/apps/kota/.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json

## Desired Outcome

Repair the local workflow/runtime cause so the same pattern no longer
fires on fresh run artifacts. The fix may live in workflow code, repair
checks, validation, queue shaping, prompts, or local runtime handling, but
it should not hide the signal by broadening infrastructure exclusions
without evidence that the failure is actually outside KOTA's control.

## Constraints

- Use existing `.kota/runs/` metadata and run artifacts as evidence.
- Keep cost and throughput data out of autonomy-agent context.
- Do not create one task per run; keep this task anchored to the stable
  root-cause fingerprint above.
- Preserve provider/auth/rate-limit/timeout exclusions unless the local
  runtime handling is the defect being repaired.

## Product / Safety Link

Persistent monitored workflow failures are a runtime posture blocker:
autonomy cannot reliably ship or review Product/Safety work while this
root cause keeps recurring. This Meta repair is actionable only because
the detector crossed the local-code threshold on concrete run artifacts.

## Done When

- Fresh run artifacts no longer trigger this pattern fingerprint, or the
  threshold/classification is deliberately adjusted with a committed reason.
- Focused tests cover the local cause and the detector behavior that would
  have caught this recurrence.
- Operator-facing attention output still reports future escalations with
  the generated task id and without cost fields.

## Source / Intent

Auto-created by `workflow-failure-escalator` from recent workflow run
metadata. Persistent non-infrastructure workflow failures should become
one evidence-backed repair task instead of remaining only in digests or
improver context.

## Initiative

Autonomy fleet health: recurring local workflow failures should graduate
into deterministic, reviewable repair work.

## Acceptance Evidence

- Test output for the repaired workflow or runtime path.
- Detector test or run artifact showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Attention-event fixture or transcript showing any future escalation names
  the task id without cost fields.
- Completed in builder run `2026-06-22T13-59-49-848Z-builder-w1gvlk`.
  Focused trajectory escalation tests pass, source and built detector scans
  over `.kota/runs` return `count: 0`, and the run evidence records the
  compact clean control-monitor regression plus final verification commands.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:trajectory-diagnostic-escalator:step-error:e7feb8f277b6 -->
<!-- workflow-failure-evidence-fingerprint: 57847f4a2c1e5ad3ca2b2f4de353555ca370eacff310aa2cdaa35325e655d651 -->
