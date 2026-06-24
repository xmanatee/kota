---
id: task-add-observability-evidence-for-runtime-health-cont
title: Add observability evidence for runtime health control coverage helpers
status: ready
priority: p2
area: autonomy
summary: Builder run 2026-06-24T18-02-58-232Z-builder-4wf2qh resolved the runtime-health source-size split, but its observability-obligation diagnostic reports missing inspectable evidence for src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts and runtime-health-audit-control-coverage.ts after approval and agent-harness-sensitive changes.
created_at: 2026-06-24T18:33:46.547Z
updated_at: 2026-06-24T18:33:46.547Z
---

## Problem

Builder run 2026-06-24T18-02-58-232Z-builder-4wf2qh resolved the runtime-health source-size split, but its observability-obligation diagnostic reports missing inspectable evidence for src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage-gates.ts and runtime-health-audit-control-coverage.ts after approval and agent-harness-sensitive changes.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T18-25-05-282Z-progress-reviewer-l8ese3.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T18-25-05-282Z-progress-reviewer-l8ese3.

review verdict: needs-steering
review summary: Needs steering: balance is Product 1, Safety 4, Platform 5, Meta 1, Unclassified 9, with no operator-journey risks or open dead letters. The batch closed three build tasks, but the latest runtime-health split left a new observability-obligation warning for two runtime-sensitive files.

Evidence ids:

- run:2026-06-24T18-02-58-232Z-builder-4wf2qh
- event:evtj-000000103261
- task:task-split-runtime-health-audit-control-coverage-source
- git:commit:ba6007953c0f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record structured logging, event or run-artifact evidence, explicit error-result assertions, focused test assertions, or an explicit rationale/waiver for both cited files; rerun focused runtime-health control coverage validation and produce an observability-obligation review or equivalent artifact showing outcome ok or justified waiver.
