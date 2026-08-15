---
id: task-security-review-mcp-oauth-metadata-may-designate-a
title: Security review: MCP OAuth metadata may designate an arbitrary plain-HTTP or private-network token endpoint, and fetchOAuthJson automatically adds that endpoint's origin to its outbound allowlist. Secret-bearing token requests can therefore transmit authorization codes, PKCE verifiers, client secrets, private-key assertions, or enterprise subject tokens without TLS or to an internal service selected by compromised metadata.
status: done
priority: p1
area: security
task_class: Safety
summary: MCP OAuth metadata may designate an arbitrary plain-HTTP or private-network token endpoint, and fetchOAuthJson automatically adds that endpoint's origin to its outbound allowlist. Secret-bearing token requests can therefore transmit authorization codes, PKCE verifiers, client secrets, private-key assertions, or enterprise subject tokens without TLS or to an internal service selected by compromised metadata.
created_at: 2026-08-15T06:01:56.166Z
updated_at: 2026-08-15T08:36:23.932Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/mcp/client-oauth-token-runtime.ts
claim:

> MCP OAuth metadata may designate an arbitrary plain-HTTP or private-network token endpoint, and fetchOAuthJson automatically adds that endpoint's origin to its outbound allowlist. Secret-bearing token requests can therefore transmit authorization codes, PKCE verifiers, client secrets, private-key assertions, or enterprise subject tokens without TLS or to an internal service selected by compromised metadata.

## Desired Outcome

> Require HTTPS for configured OAuth issuers and every metadata-derived authorization, token, and registration endpoint, with any plain-HTTP exception limited to an explicit literal-loopback development policy. Do not authorize a metadata-derived endpoint merely by adding its own URL to allowedOrigins; validate it against trusted issuer policy and reject private-network targets unless explicitly configured. Add tests proving remote HTTP and metadata-selected loopback token endpoints are rejected before credentials or request bodies are dispatched.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T03-56-05-517Z-security-review-cjjcs5.

finding id: security-review-mcp-oauth-insecure-endpoint-policy
candidate id: secret-handling:src/core/mcp/client-oauth-token-runtime.ts:619
verdict: confirmed
rationale:

> The issuer is equality-checked, but its metadata-derived endpoints remain unrestricted: client-authorization-protocol.ts:333-357 permits HTTP for endpoints and issuers, and client-oauth-token-runtime.ts:223-245 applies that permissive normalization to token, authorization, and registration endpoints. fetchOAuthJson at client-oauth-token-runtime.ts:848-882 then constructs oauthProtectedResource([issuer, url]), effectively allowlisting the requested endpoint's own origin. network-policy.ts:31-40 checks only origin membership for that profile and performs no TLS, loopback, private-address, or DNS validation. Secret-bearing POSTs—including client-secret authentication at client-oauth-token-runtime.ts:613-625 and refresh tokens/client secrets at lines 820-839—are therefore dispatched directly to metadata-selected plain-HTTP or private-network endpoints. Redirect replay protections do not protect the initial selected endpoint.

Evidence:

Evidence 1:



path: src/core/mcp/client-authorization-protocol.ts

line: 333

excerpt:



> normalizeHttpUrl accepts both http: and https: URLs; it does not require TLS or restrict plain HTTP to literal loopback.

Evidence 2:



path: src/core/mcp/client-oauth-token-runtime.ts

line: 228

excerpt:



> tokenEndpoint: normalizeHttpUrl(metadata.tokenEndpoint, "token_endpoint")

Evidence 3:



path: src/core/mcp/client-oauth-token-runtime.ts

line: 622

excerpt:



> headers.Authorization = clientSecretBasicAuthorizationHeader(client.clientId, client.clientSecret);

Evidence 4:



path: src/core/mcp/client-oauth-token-runtime.ts

line: 870

excerpt:



> fetchOAuthJson builds oauthProtectedResource([issuer, url]) from the requested metadata endpoint itself, then sends init.headers and init.body to that URL.

Evidence 5:



path: src/core/outbound-http/network-policy.ts

line: 35

excerpt:



> The oauth-protected-resource policy only checks that url.origin appears in profile.allowedOrigins; it performs no public-network or TLS validation.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/mcp src/core/outbound-http` — 17 test files and 283 tests passed, including remote-HTTP and private/loopback endpoint rejection before OAuth credential dispatch.
- `pnpm typecheck`, `pnpm build`, and `pnpm lint` passed.
- `pnpm test src/strict-types-policy.integration.test.ts src/root-layout.test.ts` — 2 test files and 3 guard tests passed.
