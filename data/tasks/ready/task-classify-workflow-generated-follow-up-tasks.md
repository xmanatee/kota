---
id: task-classify-workflow-generated-follow-up-tasks
title: Classify workflow-generated follow-up tasks
status: ready
priority: p3
area: autonomy
summary: Recent progress-review evidence reports zero Safety or Platform work and ten Unclassified tasks while the same window includes security-review and platform/DLQ follow-up tasks. Add task_class metadata or an equivalent deterministic mapping for workflow-generated follow-up tasks so security findings, platform observability work, and runtime repair work contribute to the intended Product/Safety/Platform/Meta balance.
created_at: 2026-07-01T08:42:46.240Z
updated_at: 2026-07-01T08:42:46.240Z
---

## Problem

Recent progress-review evidence reports zero Safety or Platform work and ten Unclassified tasks while the same window includes security-review and platform/DLQ follow-up tasks. Add task_class metadata or an equivalent deterministic mapping for workflow-generated follow-up tasks so security findings, platform observability work, and runtime repair work contribute to the intended Product/Safety/Platform/Meta balance.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-01T04-25-57-565Z-progress-reviewer-j61p3u.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-01T04-25-57-565Z-progress-reviewer-j61p3u.

review verdict: needs-steering
review summary: KOTA is making concrete progress: recent security, observability, and DLQ cleanup work landed; dead-letter counts report 0 open items; no operator-journey risks were reported. Balance is Product 0, Safety 0, Platform 0, Meta 1, Unclassified 10, so the remaining steering gap is task-class metadata: recent security/platform work is being reported as Unclassified.

Evidence ids:

- scope:8nrg1m:task:task-security-review-autonomy-health-review-artifacts-s
- scope:8nrg1m:task:task-security-review-autonomy-health-review-task-genera
- scope:8nrg1m:task:task-add-observability-evidence-for-mobile-typecheck-wr
- scope:8nrg1m:task:task-clear-stale-builder-dlq-items-after-repair-merge

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A focused workflow/task-generation test or fixture creates representative security-review and progress-reviewer follow-up tasks and shows their frontmatter or collected evidence reports the expected task_class values instead of leaving those tasks Unclassified.
