---
id: task-security-review-httprequest-preserves-caller-suppl
title: Security review: http_request preserves caller-supplied custom headers across cross-origin redirects, so secret-bearing headers such as X-API-Key can be forwarded to a redirected origin.
status: done
priority: p2
area: security
summary: http_request preserves caller-supplied custom headers across cross-origin redirects, so secret-bearing headers such as X-API-Key can be forwarded to a redirected origin.
created_at: 2026-05-27T07:59:59.322Z
updated_at: 2026-05-27T08:04:25Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/web-access/private-network.ts
claim: http_request preserves caller-supplied custom headers across cross-origin redirects, so secret-bearing headers such as X-API-Key can be forwarded to a redirected origin.

## Desired Outcome

On cross-origin redirects, strip all caller-supplied headers except an explicit safe allowlist, or stop and require the caller to re-issue the request to the redirected origin. Add a regression test for X-API-Key-style headers.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T07-54-20-594Z-security-review-fekkff.

finding id: security-review-cross-origin-custom-header-redirect-leak
candidate id: external-fetch:src/modules/web-access/private-network.ts:153
verdict: confirmed
rationale: runHttpRequest merges caller-supplied headers into the request, and fetchPublicWebAccessUrl only strips Authorization, Cookie, and Proxy-Authorization on cross-origin redirects. Existing tests also assert a custom header is preserved after such a redirect, so an X-API-Key-style secret header would be forwarded.

Evidence:

- src/modules/web-access/http-request.ts:77 - const headers = (input.headers as Record<string, string>) || {};
- src/modules/web-access/http-request.ts:119 - ...headers,
- src/modules/web-access/private-network.ts:106 - if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
- src/modules/web-access/private-network.ts:107 - headers = stripCrossOriginCredentialHeaders(headers);
- src/modules/web-access/private-network.ts:28 - const CROSS_ORIGIN_CREDENTIAL_HEADERS = new Set([
- src/modules/web-access/private-network.ts:135 - stripped[name] = value;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/web-access/http-request.test.ts src/modules/web-access/web-fetch.test.ts` passed.
- `pnpm typecheck` passed.
