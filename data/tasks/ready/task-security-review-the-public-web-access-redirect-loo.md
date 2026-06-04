---
id: task-security-review-the-public-web-access-redirect-loo
title: Security review: The public web-access redirect loop preserves request bodies across cross-origin redirects while only filtering headers, allowing `http_request` POST/PUT/PATCH bodies to be replayed to a different origin on 307/308 redirects and leaking sensitive request data.
status: ready
priority: p2
area: security
summary: The public web-access redirect loop preserves request bodies across cross-origin redirects while only filtering headers, allowing `http_request` POST/PUT/PATCH bodies to be replayed to a different origin on 307/308 redirects and leaking sensitive request data.
created_at: 2026-06-04T10:34:18.611Z
updated_at: 2026-06-04T10:34:18.611Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/web-access/private-network.ts
claim: The public web-access redirect loop preserves request bodies across cross-origin redirects while only filtering headers, allowing `http_request` POST/PUT/PATCH bodies to be replayed to a different origin on 307/308 redirects and leaking sensitive request data.

## Desired Outcome

Reject cross-origin redirects for requests with a body or non-idempotent method unless an explicit opt-in exists; at minimum drop the body and content-type on any origin change and add tests for 307/308 POST and PATCH redirects.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T08-50-47-847Z-security-review-doj5lc.

finding id: security-review-cross-origin-redirect-body-leak
candidate id: external-fetch:src/modules/web-access/private-network.ts:156
verdict: confirmed
rationale: Confirmed. http_request accepts caller-supplied bodies and stores them in RequestInit at src/modules/web-access/http-request.ts:123-124. fetchPublicWebAccessUrl carries body through the redirect loop at src/modules/web-access/private-network.ts:64 and sends it on each request at src/modules/web-access/private-network.ts:74-81. On an origin change it only filters headers at src/modules/web-access/private-network.ts:106-109; body is cleared only for 303 or POST 301/302 at src/modules/web-access/private-network.ts:111-114, leaving 307/308 POST, PUT, and PATCH bodies replayable to a different public origin.

Evidence:

- src/modules/web-access/http-request.ts:124 - fetchOptions.body = body;
- src/modules/web-access/private-network.ts:64 - let body = init.body;
- src/modules/web-access/private-network.ts:74 - const requestInit: RequestInit = {
- src/modules/web-access/private-network.ts:107 - if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
- src/modules/web-access/private-network.ts:108 - headers = retainCrossOriginRedirectSafeHeaders(headers);
- src/modules/web-access/private-network.ts:111 - if (response.status === 303 || ((response.status === 301 || response.status === 302) && normalizedMethod === "POST")) {
- src/modules/web-access/private-network.ts:113 - body = undefined;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
