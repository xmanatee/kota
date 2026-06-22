---
id: task-security-review-a-stdio-mcp-server-that-receives-c
title: Security review: A stdio MCP server that receives configured transport env secrets can write those secrets to stderr and KOTA forwards them to terminal diagnostics without applying the existing MCP secret redaction path.
status: done
priority: p2
area: security
summary: A stdio MCP server that receives configured transport env secrets can write those secrets to stderr and KOTA forwards them to terminal diagnostics without applying the existing MCP secret redaction path.
created_at: 2026-06-21T11:55:41.150Z
updated_at: 2026-06-22T00:33:26.381Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-connection.ts
claim:

> A stdio MCP server that receives configured transport env secrets can write those secrets to stderr and KOTA forwards them to terminal diagnostics without applying the existing MCP secret redaction path.

## Desired Outcome

> Redact stdio MCP stderr chunks with the same configured-secret redaction used for MCP request errors before calling writeTerminalStderr, and add a regression test where a stdio MCP fixture prints a configured env secret to stderr.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-21T11-50-06-293Z-security-review-xhrwer.

finding id: mcp-stdio-stderr-secret-diagnostic-leak
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:14
verdict: confirmed
rationale:

> McpStdioClientTransportConfig allows env values at src/core/mcp/client-auth-types.ts:17, and connectStdio passes those values into the spawned process at src/core/mcp/client-connection.ts:76. The child stderr handler writes stderr directly via writeTerminalStderr at src/core/mcp/client-connection.ts:93-95; writeTerminalStderr forwards text unchanged at src/core/modules/terminal-renderer.ts:31-37. The existing redaction path includes stdio env values at src/core/mcp/client-base.ts:389-391 and applies them at src/core/mcp/client-base.ts:419-424, but that path is not called by the stderr handler. Existing coverage at src/core/mcp/manager.test.ts:412-457 proves stdio env values are redacted from MCP tool errors, not from stderr diagnostics.

Evidence:

Evidence 1:



path: src/core/mcp/client-auth-types.ts

line: 17

excerpt:



> env?: Record<string, string>;

Evidence 2:



path: src/core/mcp/client-connection.ts

line: 76

excerpt:



> env: buildMcpStdioSubprocessEnv(this.transport.env),

Evidence 3:



path: src/core/mcp/client-connection.ts

line: 95

excerpt:



> if (text) writeTerminalStderr(`[mcp:${this.serverName}] ${text}\n`);

Evidence 4:



path: src/core/mcp/client-base.ts

line: 390

excerpt:



> for (const value of Object.values(this.transport.env ?? {})) add(value);

Evidence 5:



path: src/core/mcp/client-base.ts

line: 421

excerpt:



> for (const value of this.sensitiveValuesForRedaction()) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Resolution

Stdio MCP stderr diagnostics now pass through the same configured-secret
redaction set used for MCP request errors before terminal output.

Verification:

- `pnpm test src/core/mcp/stdio-stderr-redaction.test.ts` passed.
- `pnpm exec biome check src/core/mcp/client-connection.ts src/core/mcp/stdio-stderr-redaction.test.ts` passed.
- Source-size severe evaluation returned advisory only after the regression moved out of the oversized manager test.
- `pnpm typecheck` passed.
- `pnpm validate-tasks` passed.
