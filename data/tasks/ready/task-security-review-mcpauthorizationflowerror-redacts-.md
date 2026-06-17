---
id: task-security-review-mcpauthorizationflowerror-redacts-
title: Security review: McpAuthorizationFlowError redacts authorization-flow details only in the Error.message while retaining raw resource, issuer, and scopes as public enumerable fields. A remote MCP server that echoes configured or acquired secrets through protected-resource metadata or challenge scopes can still expose those secrets through structured error serialization or object logging.
status: ready
priority: p2
area: security
summary: McpAuthorizationFlowError redacts authorization-flow details only in the Error.message while retaining raw resource, issuer, and scopes as public enumerable fields. A remote MCP server that echoes configured or acquired secrets through protected-resource metadata or challenge scopes can still expose those secrets through structured error serialization or object logging.
created_at: 2026-06-17T05:20:04.754Z
updated_at: 2026-06-17T05:20:04.754Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim: McpAuthorizationFlowError redacts authorization-flow details only in the Error.message while retaining raw resource, issuer, and scopes as public enumerable fields. A remote MCP server that echoes configured or acquired secrets through protected-resource metadata or challenge scopes can still expose those secrets through structured error serialization or object logging.

## Desired Outcome

Apply the same boundary used for McpAuthorizationError: keep raw authorization-flow state private or non-enumerable only where internal retry logic needs it, expose only a redacted projection publicly, and add regression coverage for JSON.stringify(error), Object.getOwnPropertyDescriptors(error), and public resource/issuer/scopes fields with configured secrets and acquired tokens.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-16T23-00-21-847Z-security-review-34vdn7.

finding id: mcp-auth-flow-error-public-field-leak
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:495
verdict: confirmed
rationale: Current src/core/mcp/client-auth-types.ts still stores resource, issuer, and scopes as public constructor parameter properties on McpAuthorizationFlowError while only redacting those values in the Error.message. src/core/mcp/client-authorization-runtime.ts passes protected-resource metadata and challenge scopes into that constructor. A focused runtime probe confirmed JSON.stringify(error) and Object.getOwnPropertyDescriptors(error) expose raw resource, issuer, and scopes containing configured-secret even though error.message is redacted.

Evidence:

- src/core/mcp/client-auth-types.ts:538 - readonly resource: string,
- src/core/mcp/client-auth-types.ts:539 - readonly issuer: string,
- src/core/mcp/client-auth-types.ts:540 - readonly scopes: readonly string[],
- src/core/mcp/client-auth-types.ts:546 - `resource "${redactFlowDetail(resource)}" ` +
- src/core/mcp/client-authorization-runtime.ts:75 - throw this.authorizationFlowError(
- src/core/mcp/client-authorization-runtime.ts:76 - resourceMetadata.resource,
- src/core/mcp/client-authorization-runtime.ts:78 - challengeErrorScopes,
- src/core/mcp/client.test.ts:3508 - resource: "https://mcp.example.test/mcp/configured-secret",
- src/core/mcp/client.test.ts:3560 - "www-authenticate": 'Bearer error="insufficient_scope", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read configured-secret"',

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
