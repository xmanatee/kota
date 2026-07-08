---
id: task-security-review-queued-mcp-approvals-only-pin-the-
title: Security review: Queued MCP approvals only pin the prompt-time tool declaration fingerprint, not the MCP server transport identity. If the server command, args, or URL changes while exposing the same tool declaration, an operator approval can execute a different server than the one implied when the approval was queued.
status: done
priority: p1
area: security
task_class: Safety
summary: Queued MCP approvals only pin the prompt-time tool declaration fingerprint, not the MCP server transport identity. If the server command, args, or URL changes while exposing the same tool declaration, an operator approval can execute a different server than the one implied when the approval was queued.
created_at: 2026-07-08T09:30:31.001Z
updated_at: 2026-07-08T09:44:43.916Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/approval-queue/approval-execution.ts
claim:

> Queued MCP approvals only pin the prompt-time tool declaration fingerprint, not the MCP server transport identity. If the server command, args, or URL changes while exposing the same tool declaration, an operator approval can execute a different server than the one implied when the approval was queued.

## Desired Outcome

> Capture a redacted MCP server transport identity fingerprint with the approval declaration, including stdio command/args or HTTP URL plus safe auth/header identity metadata, then reject or requeue approvals when that identity changes before execution.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-08T09-02-31-117Z-security-review-caw6t8.

finding id: security-review-mcp-approval-server-identity-not-pinned
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution.ts:97
verdict: confirmed
rationale:

> ApprovalMcpPromptDeclaration persists only server, tool, and promptDeclarationFingerprint; execution later compares only the current tool declaration fingerprint. That fingerprint includes server config name/display name and tool declaration facets, but not normalized transport material such as stdio command/args/env or HTTP URL/headers/authorization, so a changed server transport can still satisfy the queued approval check if it exposes the same declaration.

Evidence:

Evidence 1:



path: src/core/daemon/approval-queue.ts

line: 20

excerpt:



> export type ApprovalMcpPromptDeclaration = {

Evidence 2:



path: src/core/daemon/approval-queue.ts

line: 23

excerpt:



> promptDeclarationFingerprint: string;

Evidence 3:



path: src/modules/approval-queue/approval-execution.ts

line: 151

excerpt:



> const currentFingerprint = mcpManager.getToolDeclarationFingerprint(item.tool);

Evidence 4:



path: src/modules/approval-queue/approval-execution.ts

line: 152

excerpt:



> if (currentFingerprint !== declaration.promptDeclarationFingerprint) {

Evidence 5:



path: src/core/mcp/tool-declaration-fingerprint.ts

line: 66

excerpt:



> serverIdentity: {

Evidence 6:



path: src/core/mcp/tool-declaration-fingerprint.ts

line: 67

excerpt:



> serverConfigName: args.serverConfigName,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion Evidence

- `pnpm test src/core/daemon/approval-queue-mcp.test.ts src/core/tools/tool-runner-mcp-approval.test.ts src/modules/approval-queue/routes-mcp-execution.test.ts src/modules/approval-queue/routes-approve-all-race.test.ts`
- `pnpm test src/core/mcp/manager-declaration-fingerprint.test.ts src/core/mcp/manager-declaration-task-fingerprint.test.ts src/core/tools/tool-runner-mcp-declaration-contract.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm validate-tasks`
