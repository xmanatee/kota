---
id: task-project-scope-history-store-for-kotaclient-forproject
title: Project-scope history store for KotaClient.forProject
status: done
priority: p1
area: architecture
summary: Move conversation history access behind the same explicit project-scoped store boundary after knowledge and memory establish it.
created_at: 2026-05-12T15:45:00.000Z
updated_at: 2026-05-13T20:44:40.000Z
---

## Problem

History participates in recall and answer behavior, so it must not stay
daemon-global after knowledge and memory become project-scoped.

## Desired Outcome

Conversation history reads and writes resolve to one explicit project for
daemon-backed and local paths, preserving terse single-project behavior only at
the boundary.

## Initiative

Multi-project operator supervision: decompose the KotaClient.forProject
store-routing anchor into clean store-owned slices so each store becomes
project-scoped before the public client primitive lands.

## Constraints

- Reuse the daemon project registry and project runtime boundary.
- Do not add nullable internal `projectId` fields.
- Keep history provider ownership inside the history module.
- Preserve existing conversation semantics while moving storage resolution to
  an explicit project boundary.

## Done When

- History provider/store resolution is project-scoped.
- History daemon routes and client namespace calls validate or resolve project
  id through the shared project registry boundary.
- Unknown project ids fail loudly.
- A focused two-project check proves history writes do not cross projects.

## Acceptance Evidence

- Focused two-project history isolation evidence, plus queue validation.

## Source / Intent

Third sub-slice of the KotaClient.forProject per-store routing anchor.

## Unblock Precondition

```
kind: task-done
ref: task-project-scope-memory-store-for-kotaclient-forproject
```
