---
id: task-security-review-remote-task-declaration-fingerprin
title: Security review: Remote-task declaration fingerprint checks only run when the current MCP tools list still contains the original tool. If the server removes or hides that tool before resume, KOTA builds a synthetic generic tool entry with no output schema and resumes the task, so the completed result is not validated against the original declaration.
status: done
priority: p2
area: security
summary: Remote-task declaration fingerprint checks only run when the current MCP tools list still contains the original tool. If the server removes or hides that tool before resume, KOTA builds a synthetic generic tool entry with no output schema and resumes the task, so the completed result is not validated against the original declaration.
created_at: 2026-06-22T18:06:47.838Z
updated_at: 2026-06-22T18:34:40.334Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/manager.ts
claim:

> Remote-task declaration fingerprint checks only run when the current MCP tools list still contains the original tool. If the server removes or hides that tool before resume, KOTA builds a synthetic generic tool entry with no output schema and resumes the task, so the completed result is not validated against the original declaration.

## Desired Outcome

> When a persisted handle has a toolDeclarationFingerprint, require the current tool declaration to exist and match before resuming. If the tool is missing, keep the handle as a diagnostic unless the original declaration or output schema is persisted and can be used for validation.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Source Size Exception

kind: source-size-cleanup
files:
- src/core/mcp/manager.ts

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T16-40-20-747Z-security-review-k2b3dd.

finding id: mcp-remote-task-fingerprint-bypass-when-tool-is-removed
candidate id: mcp-transport:src/core/mcp/manager.ts:303
verdict: confirmed
rationale:

> entryForPersistedRemoteTask rejects declaration drift only when the current tool entry still exists. If the tool is missing, it builds a synthetic operationTool with no output_schema; the persisted handle stores only toolDeclarationFingerprint, and validateToolStructuredOutput returns null when output_schema is absent, so the resumed task result is not validated against the original declaration.

Evidence:

Evidence 1:



path: src/core/mcp/manager.ts

line: 1512

excerpt:



> toolDeclarationFingerprint: stats.toolDeclarationFingerprint,

Evidence 2:



path: src/core/mcp/manager.ts

line: 1623

excerpt:



> if (

Evidence 3:



path: src/core/mcp/manager.ts

line: 1633

excerpt:



> ${currentEntry.declaration.fingerprint}; remote task was not resumed because its

Evidence 4:



path: src/core/mcp/manager.ts

line: 1639

excerpt:



> const declarationFingerprint = handle.toolDeclarationFingerprint ?? handle.serverFingerprint;

Evidence 5:



path: src/core/mcp/manager.ts

line: 1646

excerpt:



> tool: operationTool(

Evidence 6:



path: src/core/mcp/manager.ts

line: 1027

excerpt:



> const schemaError = validateToolStructuredOutput(entry.tool, toolResult);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

Persisted remote MCP task handles that include `toolDeclarationFingerprint` now
fail closed when the current server no longer lists the original tool
declaration. The handle is retained as a diagnostic instead of resuming through
a synthetic schema-less tool, so completed task results cannot bypass the
original declaration boundary.

## Evidence

- `pnpm test src/core/mcp/manager-declaration-task-fingerprint.test.ts`
- `pnpm test src/core/mcp/manager.test.ts -t "remote task"`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run validate-tasks`
