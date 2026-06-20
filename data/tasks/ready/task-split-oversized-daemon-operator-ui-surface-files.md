---
id: task-split-oversized-daemon-operator-ui-surface-files
title: Split oversized daemon operator UI surface files
status: ready
priority: p3
area: modules
summary: The operator UI builder refactor reduced the original 1,936-line builder file, but the builder run recorded source-file-size warnings for src/modules/daemon-ops/operator-ui-control-surface.ts, src/modules/daemon-ops/operator-ui-runtime-surface.ts, and src/modules/daemon-ops/operator-ui-setup-surface.ts. Split cohesive responsibilities further, or record a narrow justified exception, while preserving the public operator UI builder API and behavior.
created_at: 2026-06-20T19:33:13.848Z
updated_at: 2026-06-20T19:33:13.848Z
---

## Problem

The operator UI builder refactor reduced the original 1,936-line builder file, but the builder run recorded source-file-size warnings for src/modules/daemon-ops/operator-ui-control-surface.ts, src/modules/daemon-ops/operator-ui-runtime-surface.ts, and src/modules/daemon-ops/operator-ui-setup-surface.ts. Split cohesive responsibilities further, or record a narrow justified exception, while preserving the public operator UI builder API and behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T19-22-59-415Z-progress-reviewer-1yj2ud.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T19-22-59-415Z-progress-reviewer-1yj2ud.

review verdict: needs-steering
review summary: Needs steering: Product 0, Safety 1, Platform 6, Meta 2, Unclassified 11. The progress-reviewer DLQ follow-up is resolved and the new security finding is already queued, but the operator UI refactor left three new surface files over the source-size guideline with no duplicate follow-up.

Evidence ids:

- task:task-refactor-operator-ui-builders
- artifact:2026-06-20T18-42-46-982Z-builder-laibg5:run-summary.json
- artifact:2026-06-20T18-42-46-982Z-builder-laibg5:operator-ui-refactor-evidence.txt
- git:commit:48b32bddb0c3

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record before/after line counts for the three cited daemon-ops operator UI surface files, keep extracted helpers co-located under src/modules/daemon-ops, preserve existing public exports and callers, and pass the focused daemon-ops operator UI tests plus pnpm typecheck.
