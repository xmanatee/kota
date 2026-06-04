---
id: task-security-review-mcp-authorization-flow-errors-reda
title: Security review: MCP authorization flow errors redact only the reason string, then interpolate resource, issuer, and scopes into the thrown error message without applying the MCP sensitive-value redactor. A remote MCP server can echo a configured or acquired bearer token in challenge scopes or protected-resource metadata and have it surfaced in logs when the follow-up authorization flow fails.
status: ready
priority: p2
area: security
summary: MCP authorization flow errors redact only the reason string, then interpolate resource, issuer, and scopes into the thrown error message without applying the MCP sensitive-value redactor. A remote MCP server can echo a configured or acquired bearer token in challenge scopes or protected-resource metadata and have it surfaced in logs when the follow-up authorization flow fails.
created_at: 2026-06-04T19:22:02.173Z
updated_at: 2026-06-04T19:22:02.173Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim: MCP authorization flow errors redact only the reason string, then interpolate resource, issuer, and scopes into the thrown error message without applying the MCP sensitive-value redactor. A remote MCP server can echo a configured or acquired bearer token in challenge scopes or protected-resource metadata and have it surfaced in logs when the follow-up authorization flow fails.

## Desired Outcome

Redact resource, issuer, and joined scopes before constructing McpAuthorizationFlowError, or make the constructor accept a redactor and apply it to every interpolated field. Add regression tests where challenge scopes and protected-resource metadata echo configured/acquired bearer tokens.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T19-03-34-314Z-security-review-tvqler.

finding id: security-review-mcp-authorization-flow-error-redaction
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:449
verdict: confirmed
rationale: Confirmed. src/core/mcp/client-authorization-runtime.ts:259 redacts only the reason before constructing McpAuthorizationFlowError, while src/core/mcp/client-auth-types.ts:467 interpolates resource, issuer, and scopes directly. Challenge scopes can be copied into challengeErrorScopes at src/core/mcp/client-authorization-runtime.ts:57-65, so remote challenge data can remain unredacted in the thrown message.

Evidence:

- src/core/mcp/client-auth-types.ts:467 - `resource "${resource}" issuer "${issuer}" scopes="${scopes.join(" ")}": ${reason}`,
- src/core/mcp/client-authorization-runtime.ts:57 - const challengeErrorScopes = config.type === "oauth"
- src/core/mcp/client-authorization-runtime.ts:62 - throw this.authorizationFlowError(
- src/core/mcp/client-authorization-runtime.ts:259 - const redactedReason = this.redactSensitiveErrorMessage(reason);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
