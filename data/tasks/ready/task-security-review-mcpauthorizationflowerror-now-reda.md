---
id: task-security-review-mcpauthorizationflowerror-now-reda
title: Security review: McpAuthorizationFlowError now redacts each OAuth scope token before joining them, so a configured secret containing whitespace can be reconstructed in the public Error.message when a remote MCP/OAuth server echoes it through scope fields that are split on whitespace.
status: ready
priority: p2
area: security
summary: McpAuthorizationFlowError now redacts each OAuth scope token before joining them, so a configured secret containing whitespace can be reconstructed in the public Error.message when a remote MCP/OAuth server echoes it through scope fields that are split on whitespace.
created_at: 2026-06-17T09:28:54.246Z
updated_at: 2026-06-17T09:28:54.246Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim: McpAuthorizationFlowError now redacts each OAuth scope token before joining them, so a configured secret containing whitespace can be reconstructed in the public Error.message when a remote MCP/OAuth server echoes it through scope fields that are split on whitespace.

## Desired Outcome

Redact the joined scope string before emitting Error.message and any public projection, or reject/normalize whitespace-bearing secrets and scope values at config boundaries. Add a regression where clientSecret is "alpha beta" and a challenge scope echoes "alpha beta" as split tokens.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-17T09-20-01-930Z-security-review-csweh4.

finding id: mcp-auth-flow-whitespace-secret-scope-redaction-bypass
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:495
verdict: confirmed
rationale: Confirmed. The current constructor redacts each scope element at src/core/mcp/client-auth-types.ts:550 and then joins them at line 556, while the previous implementation redacted scopes.join(" ") before exposing it. Challenge scope strings are split on whitespace by splitScopeParam at src/core/mcp/client-authorization-protocol.ts:119-121, and OAuth challenge scopes can flow into authorizationFlowError via src/core/mcp/client-authorization-runtime.ts:58-67 and 101-111. Because redactSensitiveErrorMessage only replaces full sensitive values at src/core/mcp/client-base.ts:416-421, a configured clientSecret such as "alpha beta" is not redacted when processed as separate "alpha" and "beta" scope tokens, then is reconstructed in Error.message and error.scopes.join(" "). Config validation only requires a non-empty clientSecret at src/core/mcp/client-authorization-protocol.ts:424-426 and does not reject whitespace.

Evidence:

- src/core/mcp/client-auth-types.ts:550 - const redactedScopes = scopes.map(redactFlowDetail);
- src/core/mcp/client-auth-types.ts:556 - scopes="${redactedScopes.join(" ")}": ${redactedReason},
- src/core/mcp/client-authorization-protocol.ts:119 - export function splitScopeParam(value: string | undefined): string[] {
- src/core/mcp/client-authorization-protocol.ts:121 - return value.split(/\s+/).filter((scope) => scope.length > 0);
- src/core/mcp/client-authorization-protocol.ts:424 - if (typeof client.clientSecret !== "string" || client.clientSecret.length === 0) {
- src/core/mcp/client-base.ts:418 - for (const value of this.sensitiveValuesForRedaction()) {
- src/core/mcp/client-base.ts:419 - redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
