---
id: task-split-oversized-harness-runtime-metadata-test-surf
title: Split oversized harness runtime metadata test surfaces
status: done
priority: p3
area: modules
summary: Builder run 2026-06-24T17-37-58-184Z-builder-4p3fni resolved the observability-evidence task, but its source-size review reported src/core/tools/delegate.test.ts at 490 lines and src/modules/vercel-agent-harness/adapter.test.ts at 521 lines after touched changes. Split cohesive helpers or record a narrow source-size cleanup exception so future harness-runtime repairs stay reviewable.
created_at: 2026-06-24T18:07:45.697Z
updated_at: 2026-06-24T21:32:14.410Z
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
- Before: cited source-size review reported `src/core/tools/delegate.test.ts` at 490 lines and `src/modules/vercel-agent-harness/adapter.test.ts` at 521 lines.
- After: the delegate suite is split into `delegate.test.ts` (184 lines), `delegate-runtime-context.test.ts` (233 lines), and `delegate-test-support.ts` (51 lines); the Vercel harness suite is split into `adapter.test.ts` (90 lines), `adapter-guardrails.test.ts` (163 lines), `adapter-options.test.ts` (138 lines), and `adapter-test-support.ts` (260 lines). Full counts are in `.kota/runs/2026-06-24T21-20-31-612Z-builder-hfiz91/source-size-line-counts.txt`.
- `pnpm test src/core/tools/delegate.test.ts src/core/tools/delegate-runtime-context.test.ts src/modules/vercel-agent-harness/adapter.test.ts src/modules/vercel-agent-harness/adapter-guardrails.test.ts src/modules/vercel-agent-harness/adapter-options.test.ts` passed: 5 files, 29 tests. Transcript: `.kota/runs/2026-06-24T21-20-31-612Z-builder-hfiz91/focused-tests.txt`.
- `pnpm typecheck` and `pnpm exec biome check` for the touched test/support files passed.
- `checkSourceFileSize(process.cwd())` against a temporary staged index returned `OK: changed source files are under source-size warning thresholds`. Transcript: `.kota/runs/2026-06-24T21-20-31-612Z-builder-hfiz91/source-size-check.txt`.
