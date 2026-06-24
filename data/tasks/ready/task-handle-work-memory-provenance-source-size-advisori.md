---
id: task-handle-work-memory-provenance-source-size-advisori
title: Handle work-memory provenance source-size advisories
status: ready
priority: p3
area: architecture
summary: Builder run 2026-06-24T21-48-14-387Z-builder-3ertwr completed the work-memory provenance task, but its source-file-size review reports touched oversized surfaces: clients/conformance/decoders.ts and clients/mobile/src/daemon/conformance/decoders.ts at 2632 lines each, plus src/core/modules/provider-types.ts at 414 lines. Split cohesive decoder/provider metadata helpers or record tightly scoped source-size cleanup exceptions while preserving work-memory provenance, recall rendering, and cross-client conformance behavior.
created_at: 2026-06-24T22:49:02.911Z
updated_at: 2026-06-24T22:49:02.911Z
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

- Before/after line-count evidence shows clients/conformance/decoders.ts, clients/mobile/src/daemon/conformance/decoders.ts, and src/core/modules/provider-types.ts no longer trigger changed-file source-size warnings for this work-memory provenance path, or each has a typed scoped exception with rationale. Focused memory, knowledge, recall, conformance, web, mobile, and Apple recall rendering tests pass, along with typecheck, lint, validate-tasks, and a source-size check.
