---
id: task-security-review-queued-approvals-for-mcp-operation
title: Security review: Queued approvals for MCP operation tools such as mcp_resources__, mcp_resource_templates__, mcp_prompts__, and mcp_skills__ are not treated as MCP-managed during approval execution. They skip MCP preflight and replay through the generic local tool registry, while live execution routes those same names through McpManager.
status: ready
priority: p2
area: security
summary: Queued approvals for MCP operation tools such as mcp_resources__, mcp_resource_templates__, mcp_prompts__, and mcp_skills__ are not treated as MCP-managed during approval execution. They skip MCP preflight and replay through the generic local tool registry, while live execution routes those same names through McpManager.
created_at: 2026-06-23T19:33:51.533Z
updated_at: 2026-06-23T19:33:51.533Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/approval-execution.ts
claim:

> Queued approvals for MCP operation tools such as mcp_resources__, mcp_resource_templates__, mcp_prompts__, and mcp_skills__ are not treated as MCP-managed during approval execution. They skip MCP preflight and replay through the generic local tool registry, while live execution routes those same names through McpManager.

## Desired Outcome

> Broaden the MCP-managed namespace policy and approval executor to cover every McpManager operation namespace, or route approved items through an MCP-aware predicate equivalent to McpManager.isMcpTool. Add regression coverage for queued approval execution and local/custom/manifest/foreign name rejection using mcp_resources__, mcp_resource_templates__, mcp_prompts__, and mcp_skills__ names.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-23T19-10-15-154Z-security-review-hjkbs8.

finding id: mcp-operation-approval-namespace-bypass
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution.ts:66
verdict: confirmed
rationale:

> Approval replay preflight and execution classify MCP-managed tools only with isMcpManagedToolName(), which checks the mcp__ prefix, at src/modules/approval-queue/approval-execution.ts:85 and :216 plus src/core/tools/tool-name-policy.ts:1-4. MCP operation names are generated with mcp_resources__, mcp_resource_templates__, mcp_prompts__, and mcp_skills__ prefixes in src/core/mcp/tool-namespace.ts:38-55 and are registered in McpManager.operationMap at src/core/mcp/manager.ts:1883-1893. Live tool dispatch treats those operations as MCP tools because McpManager.isMcpTool() returns true for operationMap entries at src/core/mcp/manager.ts:699-702 and executes them through McpManager.executeTool() at src/core/tools/tool-runner-execute-block.ts:223-229. Queued approval replay therefore skips MCP preflight for operation names and falls through to executeTool() in the local registry at src/modules/approval-queue/approval-execution.ts:226-228. The local/module/foreign tool registration paths reject only the mcp__ prefix, so operation-style names are not reserved there (src/core/tools/index.ts:163-165, src/core/modules/foreign-module-loader.ts:55-60, src/core/manifest/validation.ts:121-126).

Evidence:

Evidence 1:



path: src/modules/approval-queue/approval-execution.ts

line: 85

excerpt:



> if (!isMcpManagedToolName(item.tool)) {

Evidence 2:



path: src/modules/approval-queue/approval-execution.ts

line: 216

excerpt:



> if (isMcpManagedToolName(item.tool)) {

Evidence 3:



path: src/core/tools/tool-name-policy.ts

line: 1

excerpt:



> export const MCP_MANAGED_TOOL_PREFIX = "mcp__";

Evidence 4:



path: src/core/mcp/tool-namespace.ts

line: 38

excerpt:



> export function namespaceResourceOperation(serverName: string, action: "list" | "read"): string {

Evidence 5:



path: src/core/mcp/tool-namespace.ts

line: 48

excerpt:



> export function namespacePromptOperation(serverName: string, action: "list" | "get"): string {

Evidence 6:



path: src/core/mcp/manager.ts

line: 699

excerpt:



> isMcpTool(name: string): boolean {

Evidence 7:



path: src/core/tools/tool-runner-execute-block.ts

line: 223

excerpt:



> if (!mcpManager?.isMcpTool(call.name)) return executeTool(call.name, call.input, runnerContext);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
