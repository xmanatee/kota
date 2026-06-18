---
id: task-security-review-stdio-mcp-transport-env-values-can
title: Security review: Stdio MCP transport env values can be exposed through remote MCP error messages: KOTA passes transport.env to the subprocess, but the MCP error redaction set only collects HTTP/OAuth credentials before the manager returns error text as a tool result.
status: ready
priority: p2
area: security
summary: Stdio MCP transport env values can be exposed through remote MCP error messages: KOTA passes transport.env to the subprocess, but the MCP error redaction set only collects HTTP/OAuth credentials before the manager returns error text as a tool result.
created_at: 2026-06-18T15:06:40.130Z
updated_at: 2026-06-18T15:06:40.130Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-base.ts
claim: Stdio MCP transport env values can be exposed through remote MCP error messages: KOTA passes transport.env to the subprocess, but the MCP error redaction set only collects HTTP/OAuth credentials before the manager returns error text as a tool result.

## Desired Outcome

Include configured stdio transport.env values in MCP sensitive-value redaction and add a regression test where a stdio MCP server echoes an env secret in a JSON-RPC error; assert manager/tool output does not contain the raw value.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-18T14-07-08-076Z-security-review-1rorqi.

finding id: mcp-stdio-env-error-redaction
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:14
verdict: confirmed
rationale: Confirmed: src/core/mcp/client-connection.ts:74-77 passes transport.env into stdio subprocesses, while src/core/mcp/client-base.ts:384-413 redacts HTTP/OAuth values but not stdio transport.env. Stdio JSON-RPC errors are surfaced as raw McpJsonRpcError at src/core/mcp/client-notifications.ts:42-48 and src/core/mcp/client-decode-utils.ts:54-63, then returned as tool output by src/core/mcp/manager.ts:1419-1426. A local stdio probe with a fake configured env token returned containsSecret=true.

Evidence:

- src/core/mcp/client-auth-types.ts:17 - env?: Record<string, string>;
- src/core/mcp/client-connection.ts:76 - env: buildMcpStdioSubprocessEnv(this.transport.env),
- src/core/mcp/client-base.ts:389 - if (this.transport.type === "http") {
- src/core/mcp/client-notifications.ts:47 - reject(new McpJsonRpcError(msg.error));
- src/core/mcp/client-decode-utils.ts:59 - super(`MCP error ${error.code}: ${error.message}`);
- src/core/mcp/manager.ts:1425 - : `MCP tool error: ${(err as Error).message}`;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
