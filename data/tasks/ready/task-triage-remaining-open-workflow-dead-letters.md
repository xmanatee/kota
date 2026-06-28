---
id: task-triage-remaining-open-workflow-dead-letters
title: Triage remaining open workflow dead letters
status: ready
priority: p2
area: autonomy
summary: Current open dead letters remain for a builder build timeout, a security-review investigate-candidates timeout, and an eval-harness-cadence missing claim-result metric. These ids are not resolved by the latest workflow-failure escalator run.
created_at: 2026-06-28T13:11:09.751Z
updated_at: 2026-06-28T13:11:09.751Z
---

## Problem

Current open dead letters remain for a builder build timeout, a security-review investigate-candidates timeout, and an eval-harness-cadence missing claim-result metric. These ids are not resolved by the latest workflow-failure escalator run.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 1, Safety 1, Platform 1, Meta 0, Unclassified 6. Product and security work landed with no operator-journey risk, but the latest builder committed one task while holding another claim, failed only after commit, and the scope still has open dead letters.

Evidence ids:

- dead-letter:dlq-2cd9edfa-3573-4b28-9cfc-6c4d1ec3afb5
- dead-letter:dlq-0f0e22b8-2475-4f4f-89f3-4d90f79349b8
- dead-letter:dlq-bb5b609b-73e8-488e-a841-ed1a3e6a4852
- run:2026-06-28T12-52-30-292Z-workflow-failure-escalator-5exj71

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Each cited dead-letter id is redriven successfully, dismissed with durable rationale, or linked to a specific blocked/ready repair task; a refreshed DLQ report no longer shows these ids as open.
