---
id: task-project-scope-knowledge-store-for-kotaclient-forproject
title: Project-scope knowledge store for KotaClient.forProject
status: ready
priority: p1
area: architecture
summary: Move the knowledge store path from daemon-global provider state to an explicit project-scoped store path so future KotaClient.forProject routing cannot leak entries across projects.
created_at: 2026-05-12T15:45:00.000Z
updated_at: 2026-05-12T15:45:00.000Z
---

## Problem

`task-add-kotaclient-forproject-per-store-routing` cannot land honestly while
knowledge reads and writes still resolve through module-global provider state
keyed off the daemon's default project directory.

## Desired Outcome

Knowledge capture/search/read paths have an explicit project-scoped execution
route that can be addressed from daemon routes and client namespaces without
falling back to the daemon default project for multi-project callers.

## Initiative

Multi-project operator supervision: decompose the KotaClient.forProject
store-routing anchor into clean store-owned slices so each store becomes
project-scoped before the public client primitive lands.

## Constraints

- Reuse the daemon project registry and project runtime boundary.
- Do not add nullable internal `projectId` fields.
- Keep knowledge provider ownership inside the knowledge module.
- Preserve terse single-project calls by resolving the default project only at
  the boundary.

## Done When

- The knowledge provider/store is instantiated or resolved per project through
  the daemon's project runtime boundary or an equivalent typed per-project
  module-owned boundary.
- Knowledge daemon routes validate an explicit project id before touching
  project-scoped state.
- Local single-project calls keep their terse command surface while resolving
  to one explicit project at the boundary.
- Unknown project ids fail loudly with a typed client or route error.
- A focused two-project check proves a knowledge write in project A is not
  visible from project B.

## Acceptance Evidence

- Focused two-project knowledge evidence, either as a committed test/fixture or
  a transcript under `.kota/runs/<run-id>/`, shows isolation for valid and
  unknown project ids.
- Queue validation passes.

## Source / Intent

First sub-slice of the KotaClient.forProject per-store routing anchor. The
2026-05-12 audit retired the owner-decision blocker and selected the decomposed
per-store path.
