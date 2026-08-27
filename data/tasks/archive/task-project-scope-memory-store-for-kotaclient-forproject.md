---
status: done
---

# Project-scope memory store for KotaClient.forProject

## Problem

Memory access is part of the same per-store routing contract as knowledge, but
it should follow the first store slice so the project-scoped provider pattern
is copied once, not invented independently.

## Desired Outcome

Memory reads and writes have an explicit project-scoped execution route that
future `KotaClient.forProject(projectId)` calls can target without daemon
default-project leakage.

## Initiative

Multi-project operator supervision: decompose the KotaClient.forProject
store-routing anchor into clean store-owned slices so each store becomes
project-scoped before the public client primitive lands.

## Constraints

- Reuse the daemon project registry and project runtime boundary.
- Do not add nullable internal `projectId` fields.
- Keep memory provider ownership inside the memory module.
- Follow the knowledge-store slice's project-scoping pattern instead of
  inventing a parallel store context.

## Done When

- Memory provider/store resolution is project-scoped.
- Memory daemon routes validate project id at the same boundary as knowledge.
- Unknown project ids fail loudly.
- A focused two-project check proves memory writes do not cross projects.

## Acceptance Evidence

- Focused two-project memory isolation evidence, plus queue validation.

## Source / Intent

Second sub-slice of the KotaClient.forProject per-store routing anchor.

## Blocked on
```
kind: task-done
ref: task-project-scope-knowledge-store-for-kotaclient-forproject
```
