---
id: task-resolve-security-review-investigate-candidates-tim
title: Resolve security-review investigate-candidates timeout DLQs
status: done
priority: p2
area: autonomy
summary: Investigate and clear the open security-review workflow-dispatch dead letters for investigate-candidates timeouts, either by fixing and redriving the workflow or dismissing each item with durable rationale.
created_at: 2026-06-18T12:07:47.565Z
updated_at: 2026-06-18T12:25:49.423Z
---

## Problem

Investigate and clear the open security-review workflow-dispatch dead letters for investigate-candidates timeouts, either by fixing and redriving the workflow or dismissing each item with durable rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-18T11-40-28-197Z-progress-reviewer-p5jcqu.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

Dead-letter items `dlq-1b47a1a4-ce1a-4a7c-9b9e-b6a0e576dc65` and `dlq-0695fc11-5adf-4eac-be45-115e07361762` were dismissed through the workflow-ops DLQ command after exporting their diagnostics to this builder run directory. Both failed security-review runs stopped in `investigate-candidates` timeout after writing candidate packets but before recording any investigation findings or outcome artifact.

Later security-review runs reached terminal outcomes on newer heads, including `2026-06-16T20-30-33-983Z-security-review-6m02i4`, `2026-06-16T23-00-21-847Z-security-review-34vdn7`, `2026-06-17T09-20-01-930Z-security-review-csweh4`, and `2026-06-17T10-58-20-873Z-security-review-49m3x5`. Redriving the stale timeout triggers would duplicate superseded context rather than preserve an unreviewed finding.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-18T11-40-28-197Z-progress-reviewer-p5jcqu.

review verdict: needs-steering
review summary: The recovery batch completed, and a recent commit appears to address part of the progress-reviewer failure pattern, but the cited progress-reviewer DLQ items remain open with the stabilization task still ready. Separate recurring security-review timeout DLQs also need a focused follow-up.

Evidence ids:

- dead-letter:dlq-0695fc11-5adf-4eac-be45-115e07361762
- dead-letter:dlq-1b47a1a4-ce1a-4a7c-9b9e-b6a0e576dc65

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- DLQ items dlq-0695fc11-5adf-4eac-be45-115e07361762 and dlq-1b47a1a4-ce1a-4a7c-9b9e-b6a0e576dc65 are redriven to terminal security-review outcomes or dismissed with recorded rationale, with a run artifact or task note capturing the resolution.
- `.kota/runs/2026-06-18T12-21-26-420Z-builder-11pptd/dead-letter-before-dismissal-dlq-1b47a1a4.json` and `.kota/runs/2026-06-18T12-21-26-420Z-builder-11pptd/dead-letter-before-dismissal-dlq-0695fc11.json` preserve the original diagnostics.
- `.kota/runs/2026-06-18T12-21-26-420Z-builder-11pptd/dead-letter-resolution.md` records the dismissal rationale and verification commands.
- `pnpm dev workflow dlq list --status open --workflow security-review --json` reports `items: []`; `show` for each cited id reports `status: "dismissed"` with the recorded rationale.
