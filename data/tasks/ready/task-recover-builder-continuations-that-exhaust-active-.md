---
id: task-recover-builder-continuations-that-exhaust-active-
title: Recover builder continuations that exhaust active runtime
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Close the preserved-work recovery regression demonstrated by the recovery-triggered builder that consumed its full active-runtime budget and left an open dead letter. Timeout finalization must preserve reviewable work, avoid duplicate continuations, and provide a bounded path to disposition the claim, worktree, and related dead letter without stranding the underlying Safety task.
created_at: 2026-07-30T01:02:48.395Z
updated_at: 2026-07-30T01:02:48.395Z
---

## Problem

    Close the preserved-work recovery regression demonstrated by the recovery-triggered builder that consumed its full active-runtime budget and left an open dead letter. Timeout finalization must preserve reviewable work, avoid duplicate continuations, and provide a bounded path to disposition the claim, worktree, and related dead letter without stranding the underlying Safety task.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-29T18-09-24-191Z-progress-reviewer-njbwoq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-29T18-09-24-191Z-progress-reviewer-njbwoq.

review verdict: needs-steering
review summary:

    The 24-hour window shows concrete delivery, but the scoped outcome is not yet healthy. Task balance is Safety 2, Meta 1, Product 0, Platform 0. Two tasks completed, while a confirmed approval-boundary flaw remains ready and the recently shipped preserved-work recovery path timed out, leaving an open builder dead letter.

Evidence ids:

- scope:8nrg1m:task:task-resume-preserved-builder-work-through-agent-recove
- scope:8nrg1m:git:commit:25ce5a256c60
- scope:8nrg1m:git:commit:0545c63ea4af
- scope:8nrg1m:dead-letter:dlq-2d7964ba-7d49-4572-bdda-9d67156b3d03

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused workflow fixture drives a preserved-work recovery continuation through its configured active-runtime timeout and proves that ambiguous work remains intact with a review artifact, at most one continuation or disposition action is scheduled, and the claim, worktree, and related dead letter are cleared after a successful retry. Include a runtime recovery projection for the failed builder lineage showing no unresolved claim or open related dead letter.
