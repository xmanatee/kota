---
id: task-security-review-the-manual-redirect-loop-reuses-th
title: Security review: The manual redirect loop reuses the original RequestInit across redirect targets, so http_request forwards caller-supplied Authorization/Cookie-style headers to a different origin after a redirect.
status: ready
priority: p2
area: security
summary: The manual redirect loop reuses the original RequestInit across redirect targets, so http_request forwards caller-supplied Authorization/Cookie-style headers to a different origin after a redirect.
created_at: 2026-05-26T22:47:53.863Z
updated_at: 2026-05-26T22:47:53.863Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/web-access/private-network.ts
claim: The manual redirect loop reuses the original RequestInit across redirect targets, so http_request forwards caller-supplied Authorization/Cookie-style headers to a different origin after a redirect.

## Desired Outcome

When a redirect changes origin, strip sensitive request headers such as Authorization, Cookie, and Proxy-Authorization, or reject cross-origin redirects when caller-supplied credentials are present; add focused regression coverage.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T22-42-30-144Z-security-review-brqdwt.

finding id: security-review-http-request-cross-origin-redirect-credential-forwarding
candidate id: external-fetch:src/modules/web-access/private-network.ts:84
verdict: confirmed
rationale: http_request accepts arbitrary caller headers and merges them into fetchOptions. The redirect loop spreads the same init into every redirected request and only updates currentUrl, with no origin comparison or sensitive-header stripping before the next fetch.

Evidence:

- src/modules/web-access/http-request.ts:77 - const headers = (input.headers as Record<string, string>) || {};
- src/modules/web-access/http-request.ts:117 - headers: {
- src/modules/web-access/private-network.ts:78 - const requestInit: RequestInit = {
- src/modules/web-access/private-network.ts:109 - const nextUrl = new URL(location, currentUrl).toString();
- src/modules/web-access/private-network.ts:115 - currentUrl = nextUrl;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
