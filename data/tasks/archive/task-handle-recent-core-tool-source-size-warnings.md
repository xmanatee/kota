---
status: done
---

# Handle recent core tool source-size warnings

## Problem

Recent safety builds passed but left touched oversized core tool surfaces: src/core/tools/agent-status.test.ts from the config-redaction fix and src/core/tools/tool-runner.ts from the stale-MCP declaration guard. Split cohesive helpers/tests or record a narrow current exception without changing behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T00-51-16-385Z-progress-reviewer-9fmg1n.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T00-51-16-385Z-progress-reviewer-9fmg1n.

review verdict: needs-steering
review summary: KOTA is mostly on track, with a narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 2, Meta 1, Unclassified 14. Recent safety work closed with review evidence and no operator-journey risks, while the remaining blocked eval item has an explicit operator-capture precondition, but recent core tool changes reintroduced touched-file source-size warnings.

Evidence ids:

- artifact:2026-06-23T00-29-22-841Z-builder-sxh9ge:source-file-size-review.json
- event:evtj-000000090643
- git:commit:ea304ef32f48
- task:task-split-oversized-mcp-manager-and-tool-provenance-fi

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff reduces or justifies the cited core tool source-size warnings; focused agent-status/tool-runner tests pass; typecheck, lint, and validate-tasks pass; any remaining oversized file has a scoped exception tied to current ownership.
- Completed in builder run 2026-06-23T19-10-14-966Z-builder-sqr09y. `src/core/tools/agent-status.test.ts` was split from 352 lines into `agent-status.test.ts` at 230 lines and `agent-status-config.test.ts` at 132 lines. The cited `src/core/tools/tool-runner.ts` warning is disproven by the current 22-line file. Focused agent-status and tool-runner suites pass, `pnpm typecheck` passes, `pnpm lint` passes, `pnpm validate-tasks` passes, and the staged source-size scan reports no warnings.
