---
id: task-security-review-http-mcp-transport-and-its-oauthpr
title: Security review: HTTP MCP transport and its OAuth/protected-resource discovery paths read untrusted remote JSON/SSE/error responses without a byte cap, so a malicious or compromised MCP/OAuth endpoint can exhaust daemon memory before the request timeout fires.
status: done
priority: p2
area: security
summary: HTTP MCP transport and its OAuth/protected-resource discovery paths read untrusted remote JSON/SSE/error responses without a byte cap, so a malicious or compromised MCP/OAuth endpoint can exhaust daemon memory before the request timeout fires.
created_at: 2026-06-19T13:59:43.575Z
updated_at: 2026-06-19T14:23:10.012Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-http-runtime.ts
claim: HTTP MCP transport and its OAuth/protected-resource discovery paths read untrusted remote JSON/SSE/error responses without a byte cap, so a malicious or compromised MCP/OAuth endpoint can exhaust daemon memory before the request timeout fires.

## Desired Outcome

Add bounded response readers for MCP HTTP JSON, SSE, OAuth token, and protected-resource metadata responses. Reject oversized Content-Length early, abort streaming reads once the cap is exceeded, bound accumulated SSE buffers/message data, and cover oversized JSON/error/SSE/OAuth responses with focused tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-19T13-42-02-751Z-security-review-hi72jg.

finding id: mcp-http-unbounded-response-body
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:213
verdict: confirmed
rationale: Confirmed. MCP HTTP response handling reads untrusted bodies with response.text() for unsupported/error JSON paths at src/core/mcp/client-http-runtime.ts:155, :170, :404, and :461, and SSE streaming appends to unbounded string/line buffers at :491 and :483. OAuth and protected-resource metadata paths also parse JSON via await response.text() at src/core/mcp/client-oauth-token-runtime.ts:881 and src/core/mcp/client-protected-resource-runtime.ts:123, with the OAuth/protected-resource fetch timeout cleared after headers before body parsing. I found no MCP-side byte cap comparable to the web-access response-body-limit helpers, so a remote MCP/OAuth endpoint can force excessive daemon memory use.

Evidence:

- src/core/mcp/client-auth-types.ts:212 - export type NormalizedMcpClientTransport =
- src/core/mcp/client-http-runtime.ts:155 - const text = await response.text();
- src/core/mcp/client-http-runtime.ts:170 - : this.parseJsonRpcHttpMessage((responseText = await response.text()), method);
- src/core/mcp/client-http-runtime.ts:491 - buffer += decoder.decode(value, { stream: true });
- src/core/mcp/client-oauth-token-runtime.ts:881 - return JSON.parse(await response.text()) as JsonRpcResult;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification: `env -u NODE_OPTIONS pnpm test src/core/mcp/client.test.ts` passed (146 tests) after adding oversized JSON, error-body, one-shot SSE event-data, subscription SSE event-data, OAuth token, and protected-resource metadata regression cases.
- Verification: `env -u NODE_OPTIONS pnpm typecheck` passed.
