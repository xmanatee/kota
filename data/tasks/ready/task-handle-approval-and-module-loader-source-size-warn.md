---
id: task-handle-approval-and-module-loader-source-size-warn
title: Handle approval and module-loader source-size warnings
status: ready
priority: p3
area: architecture
summary: The queued MCP approval security fix landed successfully, but the builder run left advisory source-size warnings for src/core/daemon/approval-queue.ts, src/core/modules/foreign-module-loader.ts, and src/modules/approval-queue/routes.ts. Split cohesive helpers or record narrow scoped exceptions without changing approval execution, declaration validation, or module loading behavior.
created_at: 2026-06-23T19:13:22.030Z
updated_at: 2026-06-23T19:13:22.030Z
---

## Problem

The queued MCP approval security fix landed successfully, but the builder run left advisory source-size warnings for src/core/daemon/approval-queue.ts, src/core/modules/foreign-module-loader.ts, and src/modules/approval-queue/routes.ts. Split cohesive helpers or record narrow scoped exceptions without changing approval execution, declaration validation, or module loading behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T18-18-53-390Z-progress-reviewer-rvn0x5.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T18-18-53-390Z-progress-reviewer-rvn0x5.

review verdict: needs-steering
review summary: KOTA is progressing: Product 0, Safety 2, Platform 2, Meta 1, Unclassified 12. Recent security and builder work landed with passing review evidence and no open dead letters, but the latest builder left uncovered advisory source-size warnings on approval/module-loader surfaces.

Evidence ids:

- event:evtj-000000092492
- git:commit:0289d6be3504
- task:task-security-review-queued-approval-execution-bypasses

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff reduces or justifies the cited source-size warnings; focused approval-queue, MCP approval, foreign-module-loader, and tool-name policy tests pass; typecheck, lint, validate-tasks, and source-size review pass or record scoped exceptions.
