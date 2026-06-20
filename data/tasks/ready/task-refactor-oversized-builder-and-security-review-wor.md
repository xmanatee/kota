---
id: task-refactor-oversized-builder-and-security-review-wor
title: Refactor oversized builder and security-review workflow files touched by injection repair
status: ready
priority: p3
area: autonomy
summary: The injection repair landed successfully, but the builder run emitted source-file-size warnings for oversized builder and security-review workflow files. Split the production helpers and, where feasible, test fixtures/helpers so future safety repairs are easier to review without changing behavior.
created_at: 2026-06-20T01:21:16.957Z
updated_at: 2026-06-20T01:21:16.957Z
---

## Problem

The injection repair landed successfully, but the builder run emitted source-file-size warnings for oversized builder and security-review workflow files. Split the production helpers and, where feasible, test fixtures/helpers so future safety repairs are easier to review without changing behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T01-18-25-877Z-progress-reviewer-xehesr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T01-18-25-877Z-progress-reviewer-xehesr.

review verdict: needs-steering
review summary: Recent kota activity is progressing: Product 0, Safety 2, Platform 7, Meta 2, Unclassified 9. The security finding was fixed and committed with clean calibration, but one owner/setup question remains pending and the latest repair surfaced oversized workflow files that need a focused maintenance follow-up.

Evidence ids:

- run:2026-06-20T00-57-54-071Z-builder-2yvdx3
- task:task-visible-changed-source-size-guard
- git:commit:b105bfb9ca02

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record wc -l before/after for src/modules/autonomy/workflows/builder/repair-checks.ts and src/modules/autonomy/workflows/security-review/security-review.ts, preserve public behavior, and pass the focused builder and security-review workflow tests.
