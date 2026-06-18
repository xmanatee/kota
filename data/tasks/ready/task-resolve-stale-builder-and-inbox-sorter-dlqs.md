---
id: task-resolve-stale-builder-and-inbox-sorter-dlqs
title: Resolve stale builder and inbox-sorter DLQs
status: ready
priority: p2
area: autonomy
summary: Clean up the 11 open workflow-dispatch dead letters for builder and inbox-sorter from June 13-17. Preserve diagnostics, redrive only where the trigger is still meaningful, otherwise dismiss with recorded rationale, and classify the pattern as local-code, external-provider, or operator/setup so it does not keep surfacing as unresolved progress evidence.
created_at: 2026-06-18T12:32:27.727Z
updated_at: 2026-06-18T12:32:27.727Z
---

## Problem

Clean up the 11 open workflow-dispatch dead letters for builder and inbox-sorter from June 13-17. Preserve diagnostics, redrive only where the trigger is still meaningful, otherwise dismiss with recorded rationale, and classify the pattern as local-code, external-provider, or operator/setup so it does not keep surfacing as unresolved progress evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-18T12-21-28-788Z-progress-reviewer-y3l1bk.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-18T12-21-28-788Z-progress-reviewer-y3l1bk.

review verdict: needs-steering
review summary: Recent activity resolved two prior DLQ-focused follow-ups and downstream monitors did not raise new calibration or fan-out work, but the scope still has 11 open stale workflow-dispatch dead letters. One consolidated cleanup follow-up is warranted.

Evidence ids:

- dead-letter:dlq-0125ac43-eb22-438b-9efc-32576efafc4b
- dead-letter:dlq-13e38e22-fcbd-4a12-9077-ab5f8c28eebd
- dead-letter:dlq-19e12338-08b5-4ebc-b8ca-dcd5459c8ef9
- dead-letter:dlq-2b9557f7-d743-4bf4-9d99-fad9a2395475
- dead-letter:dlq-5318335c-7c9e-4463-bebc-383dff64ca15
- dead-letter:dlq-93b637c1-bd28-42af-a30d-dab82937182f
- dead-letter:dlq-9bf78480-37c6-423a-b025-1966f9bc118a
- dead-letter:dlq-9c1fc06a-df63-4ab9-b849-9b4c0414c3ba
- dead-letter:dlq-9e1d6b12-9e1d-4cd3-92b9-740015d97fc0
- dead-letter:dlq-ac6cffba-fedd-4f68-9b5b-b822b0f766f6
- dead-letter:dlq-d67e36f3-4b7a-4464-a00c-f8f1f6fbeb4a

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A run artifact records before/after state and rationale for all 11 cited DLQ ids; builder and inbox-sorter open-DLQ listings no longer include those stale items, or any intentionally retained item has an explicit dated rationale; validation confirms the task queue remains valid.
