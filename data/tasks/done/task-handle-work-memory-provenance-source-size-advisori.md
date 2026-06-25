---
id: task-handle-work-memory-provenance-source-size-advisori
title: Handle work-memory provenance source-size advisories
status: done
priority: p3
area: architecture
summary: Builder run 2026-06-24T21-48-14-387Z-builder-3ertwr completed the work-memory provenance task, but its source-file-size review reports touched oversized surfaces: clients/conformance/decoders.ts and clients/mobile/src/daemon/conformance/decoders.ts at 2632 lines each, plus src/core/modules/provider-types.ts at 414 lines. Split cohesive decoder/provider metadata helpers or record tightly scoped source-size cleanup exceptions while preserving work-memory provenance, recall rendering, and cross-client conformance behavior.
created_at: 2026-06-24T22:49:02.911Z
updated_at: 2026-06-25T02:31:14Z
---

## Problem

Builder run 2026-06-24T21-48-14-387Z-builder-3ertwr completed the work-memory provenance task, but its source-file-size review reports touched oversized surfaces: clients/conformance/decoders.ts and clients/mobile/src/daemon/conformance/decoders.ts at 2632 lines each, plus src/core/modules/provider-types.ts at 414 lines. Split cohesive decoder/provider metadata helpers or record tightly scoped source-size cleanup exceptions while preserving work-memory provenance, recall rendering, and cross-client conformance behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T22-44-51-863Z-progress-reviewer-poah72.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T22-44-51-863Z-progress-reviewer-poah72.

review verdict: needs-steering
review summary: Needs one narrow p3 maintainability follow-up. Balance: Safety 3, Product 1, Platform 5, Meta 1, Unclassified 10. The three recent build commits landed with successful review/test evidence and no operator-journey risk in the packet, but the latest work-memory provenance build left source-size advisories on touched conformance/provider surfaces with no active duplicate cleanup task found.

Evidence ids:

- run:2026-06-24T21-48-14-387Z-builder-3ertwr
- task:task-add-work-memory-provenance-and-correction-signals
- git:commit:b95abcff8a00

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Line-count cleanup is recorded in `.kota/runs/2026-06-25T02-14-28-199Z-builder-wx6wqu/source-size-line-counts.txt` and `.kota/runs/2026-06-25T02-14-28-199Z-builder-wx6wqu/source-size-worktree-review.json`: the former 2,632-line decoder mirrors are 15-line barrels, every extracted decoder source is under 300 lines, `src/core/modules/provider-types.ts` is a 5-line barrel, and every provider-type sibling is under 134 lines.
- The source-size worktree review reported `OK: 39 changed source files are under 300 lines`. The normal staged source-size check could not be used before this record because `.git/index.lock` writes are unavailable in this sandbox.
- Focused validation passed: root work-memory/knowledge/recall/conformance tests, web conformance and recall-render tests, mobile conformance and RecallScreen tests, and `swift test` for the Apple package.
- Static validation passed: `pnpm run typecheck`, `pnpm run lint`, `pnpm --dir clients/web run typecheck`, and `pnpm --dir clients/mobile run typecheck`.
- Queue validation passed after staging the task state change: `pnpm run validate-tasks`.
