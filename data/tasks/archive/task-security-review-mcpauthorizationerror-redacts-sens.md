---
status: done
---

# Security review: McpAuthorizationError redacts sensitive challenge details only in the error message while retaining the raw authorization challenge as an enumerable public error field. If a remote MCP server echoes a configured bearer/OAuth secret in WWW-Authenticate challenge fields, structured error serialization or object logging can expose the secret despite message redaction.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim: McpAuthorizationError redacts sensitive challenge details only in the error message while retaining the raw authorization challenge as an enumerable public error field. If a remote MCP server echoes a configured bearer/OAuth secret in WWW-Authenticate challenge fields, structured error serialization or object logging can expose the secret despite message redaction.

## Desired Outcome

Do not expose raw authorization challenge data on serializable error objects. Store raw challenge state in a private/non-enumerable field for internal retry flow, expose only a redacted projection publicly, and add regression coverage that JSON.stringify(error), object inspection of challenge fields, and thrown.message do not contain configured bearer tokens, OAuth client secrets, private keys, assertions, or acquired tokens.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-16T20-30-33-983Z-security-review-6m02i4.

finding id: mcp-auth-error-raw-challenge-leak
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:449
verdict: confirmed
rationale: Confirmed. McpAuthorizationError declares challenge as a public constructor parameter at src/core/mcp/client-auth-types.ts:426, while only the strings used in the Error.message are redacted at src/core/mcp/client-auth-types.ts:430 and src/core/mcp/client-auth-types.ts:448. The runtime passes the parsed WWW-Authenticate challenge into that field at src/core/mcp/client-authorization-runtime.ts:35 and src/core/mcp/client-authorization-runtime.ts:43. Redaction is applied by message composition through src/core/mcp/client-base.ts:416, but the raw public field remains available to structured serialization or object logging.

Evidence:

- src/core/mcp/client-auth-types.ts:426 - readonly challenge: McpAuthorizationChallenge,
- src/core/mcp/client-auth-types.ts:430 - if (challenge.error) details.push(`error=${redactChallengeDetail(challenge.error)}`);
- src/core/mcp/client-auth-types.ts:448 - super(
- src/core/mcp/client-authorization-runtime.ts:35 - const parsedChallenge = parseWwwAuthenticateChallenge(
- src/core/mcp/client-authorization-runtime.ts:43 - challenge,
- src/core/mcp/client-base.ts:416 - protected redactSensitiveErrorMessage(message: string): string {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

Fixed the confirmed leak by keeping the raw `McpAuthorizationChallenge` in
module-private retry state and exposing only a redacted public `challenge`
projection on `McpAuthorizationError`. The OAuth retry path now reads the raw
challenge through the internal accessor, so authorization behavior is preserved
without putting raw challenge fields on serializable error objects.

Verification:

- `pnpm test src/core/mcp/client.test.ts`
- `pnpm exec biome check src/core/mcp/client-auth-types.ts src/core/mcp/client-authorization-runtime.ts src/core/mcp/client.test.ts`
- `pnpm typecheck`
- `pnpm run validate-tasks`
