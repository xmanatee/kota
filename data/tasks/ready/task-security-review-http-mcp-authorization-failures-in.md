---
id: task-security-review-http-mcp-authorization-failures-in
title: Security review: HTTP MCP authorization failures interpolate remote WWW-Authenticate challenge fields into error messages without applying the MCP sensitive-value redactor, so a remote MCP server can echo a configured or acquired bearer token in challenge data and have it logged.
status: ready
priority: p2
area: security
summary: HTTP MCP authorization failures interpolate remote WWW-Authenticate challenge fields into error messages without applying the MCP sensitive-value redactor, so a remote MCP server can echo a configured or acquired bearer token in challenge data and have it logged.
created_at: 2026-06-04T17:38:09.825Z
updated_at: 2026-06-04T17:38:09.825Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim: HTTP MCP authorization failures interpolate remote WWW-Authenticate challenge fields into error messages without applying the MCP sensitive-value redactor, so a remote MCP server can echo a configured or acquired bearer token in challenge data and have it logged.

## Desired Outcome

Apply the existing MCP sensitive-value redaction to authorization challenge details before they are placed in McpAuthorizationError messages, and add a regression test where WWW-Authenticate echoes a configured bearer token.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T17-20-47-891Z-security-review-c5drms.

finding id: mcp-auth-challenge-redaction-bypass
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:444
verdict: confirmed
rationale: Confirmed. src/core/mcp/client-authorization-runtime.ts:35-44 parses the remote WWW-Authenticate header and constructs McpAuthorizationError directly. src/core/mcp/client-auth-types.ts:427-439 interpolates parsed challenge.error, resource_metadata, scope, and authorization_servers into Error.message without invoking the redactor in src/core/mcp/client-base.ts:416-421. src/core/mcp/manager.ts:1294-1296 logs err.message on connection failure, so a remote server can echo a configured bearer value in parsed challenge data and have it logged. Existing tests cover response bodies and ignored error_description, not parsed challenge fields.

Evidence:

- src/core/mcp/client-authorization-runtime.ts:35 - const parsedChallenge = parseWwwAuthenticateChallenge(response.headers.get("www-authenticate"),
- src/core/mcp/client-auth-types.ts:427 - if (challenge.error) details.push(`error=${challenge.error}`);
- src/core/mcp/client-auth-types.ts:444 - `MCP authorization failed for server "${serverName}" during ${method}: ` +
- src/core/mcp/manager.ts:1295 - `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
