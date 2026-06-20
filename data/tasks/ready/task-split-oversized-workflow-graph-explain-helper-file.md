---
id: task-split-oversized-workflow-graph-explain-helper-file
title: Split oversized workflow graph explain helper files
status: ready
priority: p3
area: modules
summary: The workflow graph explain refactor reduced the entrypoint but introduced source-size warnings because explain-graph.ts and explain-match.ts remain around 475 lines each. Split those helpers further by responsibility while preserving graph explain behavior.
created_at: 2026-06-20T16:45:39.760Z
updated_at: 2026-06-20T16:45:39.760Z
---

## Problem

The workflow graph explain refactor reduced the entrypoint but introduced source-size warnings because explain-graph.ts and explain-match.ts remain around 475 lines each. Split those helpers further by responsibility while preserving graph explain behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T16-32-59-968Z-progress-reviewer-ci2f66.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T16-32-59-968Z-progress-reviewer-ci2f66.

review verdict: needs-steering
review summary: Needs steering: Product 0, Safety 2, Platform 4, Meta 2, Unclassified 7. The batch closed the DLQ item and two refactors, but the graph explain refactor left new source-size warnings that need a narrow follow-up; the new medium security finding is already tracked as ready work.

Evidence ids:

- run:2026-06-20T16-13-29-856Z-builder-9yi39d
- task:task-refactor-workflow-graph-explain
- git:commit:5b647268d71c

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record before/after line counts for src/modules/workflow-ops/graph/explain-graph.ts and src/modules/workflow-ops/graph/explain-match.ts, keep extracted helpers co-located under src/modules/workflow-ops/graph/, and pass the focused graph explain tests plus pnpm typecheck.
