---
status: done
---

# Classify workflow-generated follow-up tasks

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

## Product / Safety Link

This Meta repair protects Product and Safety steering by making security findings and platform/runtime follow-up work visible in progress-review balance evidence instead of hiding it under Unclassified counts.

## Initiative

Outcome-aware autonomy progress review.

## Resolution

Workflow-generated task classification now has a deterministic autonomy-owned
classifier. Security-review task generation writes `task_class: Safety` for
confirmed findings. Progress-reviewer task generation writes `task_class` for
new follow-up tasks and adds the required Product / Safety link when the class
is Meta. Progress-review evidence also backfills legacy workflow-generated and
`Follow-up from` task records without frontmatter `task_class` from their
workflow source or follow-up marker plus area, so the cited security-review,
platform observability, and runtime repair tasks no longer have to remain
Unclassified in progress-review balance evidence. The cited stale builder DLQ
task now records `task_class: Platform` in frontmatter.

## Acceptance Evidence

- A focused workflow/task-generation test or fixture creates representative security-review and progress-reviewer follow-up tasks and shows their frontmatter or collected evidence reports the expected task_class values instead of leaving those tasks Unclassified.
- `src/modules/autonomy/workflows/security-review/workflow-task.test-cases.ts` asserts security-review created task frontmatter has `task_class: Safety`.
- `src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` now covers legacy generated task evidence classification as Safety/Platform/Meta, the cited stale builder DLQ `Follow-up from` pattern as Platform, and new progress-reviewer follow-up frontmatter for Safety/Platform/Meta, including the Meta Product / Safety link.
- `.kota/runs/2026-07-01T17-02-23-248Z-builder-80jejk/classification-evidence.md` records the passed validation commands.
