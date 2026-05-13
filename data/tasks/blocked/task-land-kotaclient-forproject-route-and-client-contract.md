---
id: task-land-kotaclient-forproject-route-and-client-contract
title: Land KotaClient.forProject route and client contract
status: blocked
priority: p1
area: architecture
summary: Add the public KotaClient.forProject(projectId) primitive and route/client contract once the underlying stores and pipelines are project-scoped.
created_at: 2026-05-12T15:45:00.000Z
updated_at: 2026-05-12T15:45:00.000Z
---

## Problem

The public client primitive should not land before the stores it routes to are
actually project-scoped; otherwise it would either lie about isolation or
hard-reject useful non-default project calls.

## Desired Outcome

`KotaClient.forProject(projectId)` is the single public project-scoping
primitive for daemon clients and per-store namespaces.

## Initiative

Multi-project operator supervision: finish the KotaClient.forProject
store-routing anchor after the underlying stores and cross-store pipelines have
real project isolation.

## Constraints

- Reuse the daemon project registry and project runtime boundary.
- Do not add a second channel-local project routing model.
- Do not silently fall back to the daemon default project for unknown or
  missing multi-project requests.
- Keep the public primitive small: route through existing namespaces rather
  than duplicating per-store client APIs.

## Done When

- `KotaClient.forProject(projectId)` exists and returns a project-scoped client
  whose per-store namespaces route through the selected project.
- Knowledge, memory, history, tasks, recall, answer, capture, and retract
  namespaces use the same typed project resolution path.
- Unknown project ids fail loudly with a typed client error.
- Single-project calls remain terse at the CLI/client boundary.
- The Telegram projectId channel task can depend on this completed contract.

## Acceptance Evidence

- End-to-end two-project client evidence proves `KotaClient.forProject(projectA)`
  cannot read from or write to project B across every per-store namespace.
- Queue validation passes.

## Source / Intent

Final sub-slice of the KotaClient.forProject per-store routing anchor.

## Unblock Precondition

```
kind: task-done
ref: task-project-scope-recall-answer-capture-retract-pipelines
```
