---
id: task-project-scope-recall-answer-capture-retract-pipelines
title: Project-scope recall answer capture retract pipelines
status: done
priority: p1
area: architecture
summary: Route the cross-store recall, answer, capture, and retract pipelines through explicit project-scoped store contexts after the underlying stores are scoped.
created_at: 2026-05-12T15:45:00.000Z
updated_at: 2026-05-13T23:40:27.000Z
---

## Problem

Recall, answer, capture, and retract compose the underlying stores. They cannot
be safely exposed through `KotaClient.forProject(projectId)` until their store
inputs are explicitly project-scoped.

## Desired Outcome

The cross-store pipelines accept a typed project context and route every store
read/write through that context. They do not call module-global providers for
multi-project requests.

## Initiative

Multi-project operator supervision: decompose the KotaClient.forProject
store-routing anchor into clean store-owned slices so composed pipelines become
project-scoped only after their underlying stores are scoped.

## Constraints

- Reuse the daemon project registry and project runtime boundary.
- Do not add nullable internal `projectId` fields.
- Do not hard-reject all non-default project calls as a substitute for real
  store isolation.
- Keep recall, answer, capture, and retract module ownership intact.

## Done When

- Recall, answer, capture, and retract daemon routes validate project id before
  pipeline execution.
- Pipeline internals receive an explicit project-scoped store context.
- Unknown project ids fail loudly.
- A focused two-project check proves pipeline outputs and writes do not cross
  projects.

## Acceptance Evidence

- Focused two-project evidence for recall, answer, capture, and retract:
  `pnpm test src/cross-store-project-scope.integration.test.ts src/modules/recall/routes.test.ts src/modules/capture/routes.test.ts src/modules/retract/routes.test.ts src/modules/answer/routes.test.ts src/modules/recall/recall-provider.test.ts src/modules/capture/capture-provider.test.ts src/modules/retract/retract-provider.test.ts src/modules/answer/answer-provider.test.ts src/modules/recall/contributors.test.ts src/modules/capture/contributors.test.ts src/modules/retract/contributors.test.ts src/modules/answer/recall-contributor.test.ts`
- Queue validation after staging.

## Source / Intent

Fourth sub-slice of the KotaClient.forProject per-store routing anchor.
