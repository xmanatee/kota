---
id: task-ensure-security-review-due-targets-survive-candida
title: Ensure security-review due targets survive candidate capping
status: ready
priority: p2
area: security
summary: The 2026-06-29 security-review run ended no-op, but its scan artifact reported due targets missed because the candidate cap was reached. Due security-review targets should be prioritized or explicitly reported as skipped before a no-findings outcome is recorded.
created_at: 2026-06-29T00:53:58.461Z
updated_at: 2026-06-29T00:53:58.461Z
---

## Problem

The 2026-06-29 security-review run ended no-op, but its scan artifact reported due targets missed because the candidate cap was reached. Due security-review targets should be prioritized or explicitly reported as skipped before a no-findings outcome is recorded.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T23-00-00-007Z-progress-reviewer-hkn1fd.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T23-00-00-007Z-progress-reviewer-hkn1fd.

review verdict: needs-steering
review summary: Mostly healthy KOTA progress with one narrow security-review coverage gap. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 15. The window closed security and platform follow-ups with no open dead letters or operator-journey risks, but the latest security-review no-op missed due targets behind candidate capping.

Evidence ids:

- scope:8nrg1m:run:2026-06-29T00-21-24-444Z-security-review-pn7qxo

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A focused test or replay artifact proves dueTargets are included before generic candidate caps, or that capped due targets produce an explicit non-no-op outcome; a replay of the cited security-review scan reports zero candidate-cap due-target misses; task validation passes.
