---
id: task-stabilize-progress-reviewer-review-evidence-dead-l
title: Stabilize progress-reviewer review-evidence dead letters
status: ready
priority: p1
area: autonomy
summary: Multiple open progress-reviewer DLQ items show review-evidence timing out, plus one validation failure from citing an evidence id outside the flat packet. Bound the review path so large or count-triggered packets complete or degrade deterministically and agent output cites only packet evidence ids.
created_at: 2026-06-16T22:59:46.605Z
updated_at: 2026-06-16T22:59:46.605Z
---

## Problem

Multiple open progress-reviewer DLQ items show review-evidence timing out, plus one validation failure from citing an evidence id outside the flat packet. Bound the review path so large or count-triggered packets complete or degrade deterministically and agent output cites only packet evidence ids.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-16T22-23-48-097Z-progress-reviewer-8j3ecl.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-16T22-23-48-097Z-progress-reviewer-8j3ecl.

review verdict: needs-steering
review summary: The reviewed batch delivered the security fix and quiet post-build monitors, but recurring progress-reviewer review-evidence dead letters need a bounded repair.

Evidence ids:

- dead-letter:dlq-bae315f4-fdba-4d37-bcbf-71eb563a2d9f
- dead-letter:dlq-a5ef6ca9-9be5-4ad3-8032-06fed01820e3
- dead-letter:dlq-0a676c1c-b149-4d35-87cf-9b579fb669d8
- dead-letter:dlq-3fdd4b8c-d3b5-493f-bd24-0655cfd7b9c5

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused progress-reviewer fixture or redrive artifact showing a large run-count evidence packet returns schema-valid JSON within the step timeout, cites only ids from the flat evidence array, and records redrive or dismissal evidence for the cited DLQ items.
