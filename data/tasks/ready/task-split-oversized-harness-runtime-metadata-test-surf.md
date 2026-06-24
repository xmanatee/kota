---
id: task-split-oversized-harness-runtime-metadata-test-surf
title: Split oversized harness runtime metadata test surfaces
status: ready
priority: p3
area: modules
summary: Builder run 2026-06-24T17-37-58-184Z-builder-4p3fni resolved the observability-evidence task, but its source-size review reported src/core/tools/delegate.test.ts at 490 lines and src/modules/vercel-agent-harness/adapter.test.ts at 521 lines after touched changes. Split cohesive helpers or record a narrow source-size cleanup exception so future harness-runtime repairs stay reviewable.
created_at: 2026-06-24T18:07:45.697Z
updated_at: 2026-06-24T18:07:45.697Z
---

## Problem

Builder run 2026-06-24T17-37-58-184Z-builder-4p3fni resolved the observability-evidence task, but its source-size review reported src/core/tools/delegate.test.ts at 490 lines and src/modules/vercel-agent-harness/adapter.test.ts at 521 lines after touched changes. Split cohesive helpers or record a narrow source-size cleanup exception so future harness-runtime repairs stay reviewable.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T17-51-12-781Z-progress-reviewer-03r2sb.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T17-51-12-781Z-progress-reviewer-03r2sb.

review verdict: needs-steering
review summary: Needs steering. Balance: Safety 4, Product 1, Platform 6, Meta 1, Unclassified 8. Recent builder and monitor runs are mostly healthy, with no operator-journey risks or open dead letters in the packet, but builder run 2026-06-24T17-37-58-184Z-builder-4p3fni left source-size advisories on two harness runtime-metadata test surfaces without an active matching cleanup task.

Evidence ids:

- run:2026-06-24T17-37-58-184Z-builder-4p3fni
- task:task-add-observability-evidence-for-agent-authored-runt
- artifact:2026-06-24T17-37-58-184Z-builder-4p3fni:source-file-size-review.json
- artifact:2026-06-24T17-37-58-184Z-builder-4p3fni:run-summary.json
- git:commit:773fe5e2fb9b

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff splits cohesive delegate/vercel harness test helpers or records a typed source-size cleanup exception with rationale; focused harness runtime metadata tests pass; a staged source-size check or later builder run no longer reports these touched files as source-size warnings.
