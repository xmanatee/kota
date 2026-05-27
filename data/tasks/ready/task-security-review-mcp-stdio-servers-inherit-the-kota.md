---
id: task-security-review-mcp-stdio-servers-inherit-the-kota
title: Security review: MCP stdio servers inherit the KOTA process's full environment, so parent credentials and real values previously injected by get_secret are exposed to every spawned stdio MCP subprocess unless explicitly filtered.
status: ready
priority: p1
area: security
summary: MCP stdio servers inherit the KOTA process's full environment, so parent credentials and real values previously injected by get_secret are exposed to every spawned stdio MCP subprocess unless explicitly filtered.
created_at: 2026-05-27T01:13:29.537Z
updated_at: 2026-05-27T01:13:29.537Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/mcp/client-connection.ts
claim: MCP stdio servers inherit the KOTA process's full environment, so parent credentials and real values previously injected by get_secret are exposed to every spawned stdio MCP subprocess unless explicitly filtered.

## Desired Outcome

Stop MCP stdio from inheriting raw process.env. Build the subprocess environment through an explicit filtered boundary, merge only declared transport.env and required runtime basics, and add regression coverage proving parent secrets, get_secret-injected values, KOTA_SESSION_ID, KOTA_TOOL_USE_ID, and OTEL/OTLP variables are absent unless explicitly configured.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T01-05-47-574Z-security-review-7dcilz.

finding id: security-review-mcp-stdio-inherits-agent-secret-env
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:14
verdict: confirmed
rationale: src/core/mcp/client-connection.ts:62-64 still spawns stdio MCP servers with env: { ...process.env, ...(this.transport.env ?? {}) }, so the child receives the parent process environment by default. src/modules/secrets/index.ts:75-76 still writes get_secret values into process.env. The filtered subprocess environment helper exists in src/core/modules/subprocess-env.ts:1-18, but the MCP client path does not use it, so parent credentials, get_secret-injected values, KOTA_SESSION_ID, KOTA_TOOL_USE_ID, and OTEL/OTLP variables can be inherited unless explicitly absent from the parent process.

Evidence:

- src/core/mcp/client-auth-types.ts:13 - export type McpStdioClientTransportConfig = {
- src/core/mcp/client-auth-types.ts:17 - env?: Record<string, string>;
- src/core/mcp/client-connection.ts:62 - this.proc = spawn(this.transport.command, this.transport.args ?? [], {
- src/core/mcp/client-connection.ts:64 - env: { ...process.env, ...(this.transport.env ?? {}) },
- src/modules/secrets/index.ts:76 - process.env[name] = value;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
