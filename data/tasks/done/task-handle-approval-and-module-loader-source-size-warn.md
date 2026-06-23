---
id: task-handle-approval-and-module-loader-source-size-warn
title: Handle approval and module-loader source-size warnings
status: done
priority: p3
area: architecture
summary: The queued MCP approval security fix landed successfully, but the builder run left advisory source-size warnings for src/core/daemon/approval-queue.ts, src/core/modules/foreign-module-loader.ts, and src/modules/approval-queue/routes.ts. Split cohesive helpers or record narrow scoped exceptions without changing approval execution, declaration validation, or module loading behavior.
created_at: 2026-06-23T19:13:22.030Z
updated_at: 2026-06-23T23:02:10.805Z
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

- Split approval storage/projection and event emission into `src/core/daemon/approval-queue-projection.ts` and `src/core/daemon/approval-queue-events.ts`; `src/core/daemon/approval-queue.ts` is now 297 lines.
- Split KEMP session/tool proxying and resilient stdio restart handling into `src/core/modules/foreign-module-session.ts` and `src/core/modules/foreign-module-resilient-loader.ts`; `src/core/modules/foreign-module-loader.ts` is now 73 lines.
- Split approval route helpers, exported handlers, and route registrations into module-local `route-*` siblings; `src/modules/approval-queue/routes.ts` is now the public 8-line surface and each helper is below 300 lines.
- Focused approval-queue, MCP approval, foreign-module-loader, and tool-name policy tests passed; typecheck, lint, strict-types/module-boundary checks, task validation, and the staged source-size check passed. See `.kota/runs/2026-06-23T22-39-33-706Z-builder-pau4ca/validation.txt` and `source-size-line-counts.txt`.
- The normal `pnpm kota task move` commands for both `doing` and `done` failed in their `git mv` path, so the task file was moved directly to keep state aligned with the completed work and then staged with `git add -A`.
