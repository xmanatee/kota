---
id: task-split-oversized-mcp-client-and-agent-step-source-f
title: Split oversized MCP client and agent-step source files
status: ready
priority: p3
area: architecture
summary: The stderr redaction build passed, but its source-size review still reported advisory warnings for src/core/mcp/client-connection.ts and src/core/workflow/steps/step-executor-agent.ts. Split cohesive helpers or record a narrow typed exception without changing MCP stderr redaction or workflow agent-step behavior.
created_at: 2026-06-22T01:23:33.294Z
updated_at: 2026-06-22T01:23:33.294Z
---

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
