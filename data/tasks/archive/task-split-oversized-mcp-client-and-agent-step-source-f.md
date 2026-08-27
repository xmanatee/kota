---
status: done
---

# Split oversized MCP client and agent-step source files

## Problem

The stderr redaction build passed, but its source-size review still reported advisory warnings for src/core/mcp/client-connection.ts and src/core/workflow/steps/step-executor-agent.ts. Split cohesive helpers or record a narrow typed exception without changing MCP stderr redaction or workflow agent-step behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T01-03-38-502Z-progress-reviewer-kgdhx1.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T01-03-38-502Z-progress-reviewer-kgdhx1.

review verdict: needs-steering
review summary: KOTA is mostly on track but needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 6, Meta 0, Unclassified 10. The recent security remediation landed with critic approval and a new security finding was queued, with no operator-journey risk, but the build still left two touched oversized core files with advisory source-size warnings and no active duplicate cleanup.

Evidence ids:

- artifact:2026-06-22T00-29-09-294Z-builder-lyamru:source-file-size-review.json
- artifact:2026-06-22T00-29-09-294Z-builder-lyamru:run-summary.json
- task:task-escalate-severe-source-size-warnings-before-commit
- git:commit:c06c366b3497

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts are recorded; builder source-size diagnostics no longer warn on both cited files, or a typed narrow exception is justified; focused MCP stdio stderr redaction and workflow agent-step tests pass; typecheck, lint, and validate-tasks pass.
- Before/after line counts are recorded in `.kota/runs/2026-06-22T02-09-19-731Z-builder-ey8a49/source-size-evidence.json`: `src/core/mcp/client-connection.ts` went from 390 to 172 lines, and `src/core/workflow/steps/step-executor-agent.ts` went from 451 to 250 lines.
- Split MCP stdio process/request handling into `src/core/mcp/client-stdio-runtime.ts`; split workflow agent-step single-attempt, idle, output, and run-option helpers into focused `src/core/workflow/steps/step-executor-agent-*.ts` phase files without changing stderr redaction or agent-step behavior.
- Passed `pnpm test src/core/mcp/stdio-stderr-redaction.test.ts src/core/workflow/steps/step-executor-agent-prompt.test.ts src/core/workflow/steps/step-executor-agent-tool-scope.test.ts src/core/workflow/steps/step-executor-agent-capability.test.ts src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts`.
- Passed `pnpm typecheck` and `pnpm lint`.
- Passed real-index `pnpm validate-tasks` after final `git add -A`; `.kota/runs/2026-06-22T02-09-19-731Z-builder-ey8a49/validation-notes.txt` records the initial index-lock failures and final validation result.
