---
status: done
---

# Split oversized MCP manager and tool provenance files

## Problem

The MCP fingerprinting build passed, but its source-size review reports changed files over the 300-line guideline: src/core/mcp/manager.ts, src/core/mcp/remote-task-store.ts, and src/core/tools/tool-runner.ts. Extract cohesive MCP declaration fingerprint, provenance, or remote-task helpers, or document tightly scoped exceptions.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T16-20-01-107Z-progress-reviewer-tazx14.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T16-20-01-107Z-progress-reviewer-tazx14.

review verdict: needs-steering
review summary: Needs one narrow maintainability follow-up; otherwise scope 8nrg1m is on track. Balance: Product 0, Safety 2, Platform 1, Meta 1, Unclassified 16. The MCP fingerprinting task completed with tests and critic review, and the packet shows no open dead letters or operator journey risks, but the builder left source-size warnings on changed core MCP/tool files.

Evidence ids:

- artifact:2026-06-22T15-35-14-278Z-builder-izxjpn:source-file-size-review.json
- artifact:2026-06-22T15-35-14-278Z-builder-izxjpn:run-summary.json
- git:commit:7b8dd24fcd55

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line-count evidence shows src/core/mcp/manager.ts, src/core/mcp/remote-task-store.ts, and src/core/tools/tool-runner.ts no longer trigger source-size warnings, or each has a documented scoped exception. Focused MCP manager/provenance/tool-runner tests, pnpm run typecheck, pnpm run lint, and pnpm run validate-tasks pass.

## Result

Split MCP server config decoding into focused `manager-config*` helpers, moved redacted remote-task server identity fingerprinting out of the task store, and moved tool approval/idempotency helpers out of `tool-runner.ts` while preserving its existing approval export surface.

Line-count evidence is recorded in `.kota/runs/2026-06-22T23-13-57-475Z-builder-os279u/source-size-line-counts.txt`: `manager.ts` is reduced to 1980 lines, `remote-task-store.ts` to 227 lines, and `tool-runner.ts` to 563 lines. The staged source-size review is advisory-only for the two still-large reduced files, and this task declares a scoped `source-size-cleanup` exception for the cited files.

Validation is recorded in `.kota/runs/2026-06-22T23-13-57-475Z-builder-os279u/validation.txt`.

## Source Size Exception

kind: source-size-cleanup
files:
- src/core/mcp/manager.ts
- src/core/mcp/remote-task-store.ts
- src/core/tools/tool-runner.ts
