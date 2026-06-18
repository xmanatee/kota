---
id: task-security-review-stdio-mcp-transport-env-values-can
title: Security review: Stdio MCP transport env values can be exposed through remote MCP error messages: KOTA passes transport.env to the subprocess, but the MCP error redaction set only collects HTTP/OAuth credentials before the manager returns error text as a tool result.
status: done
priority: p2
area: security
summary: Stdio MCP transport env values can be exposed through remote MCP error messages: KOTA passes transport.env to the subprocess, but the MCP error redaction set only collects HTTP/OAuth credentials before the manager returns error text as a tool result.
created_at: 2026-06-18T15:06:40.130Z
updated_at: 2026-06-18T15:18:20.275Z
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

## Result

Configured stdio MCP `transport.env` values now enter the MCP client's sensitive-value redaction set. Post-initialize stdio request failures are normalized through the same method-aware redacting error constructor used by HTTP requests, so a remote JSON-RPC `tools/call` error that echoes a configured env value reaches `McpManager.executeTool` as `[redacted]` instead of the raw value. The `initialize` request remains unwrapped so protocol-version fallback can still inspect structured JSON-RPC error data.

## Verification

- `pnpm test src/core/mcp/manager.test.ts -- -t "redacts configured stdio env values echoed through MCP tool errors"` (the command ran the full `manager.test.ts` file: 65 tests passed)
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/core/mcp/client.test.ts -t "callTool surfaces JSON-RPC errors|falls back to the legacy handshake|passes sensitive env names"` (3 focused tests passed)
- `pnpm test src/core/mcp/client.test.ts` (140 tests passed)
- `pnpm typecheck`
- `pnpm validate-tasks`
