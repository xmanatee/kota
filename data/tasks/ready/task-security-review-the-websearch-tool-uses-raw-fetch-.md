---
id: task-security-review-the-websearch-tool-uses-raw-fetch-
title: Security review: The web_search tool uses raw fetch for Brave and DuckDuckGo instead of the shared public-target fetcher, so redirects are not revalidated against loopback/private-network targets. The Brave path also sends X-Subscription-Token through this unguarded redirect path.
status: ready
priority: p2
area: security
summary: The web_search tool uses raw fetch for Brave and DuckDuckGo instead of the shared public-target fetcher, so redirects are not revalidated against loopback/private-network targets. The Brave path also sends X-Subscription-Token through this unguarded redirect path.
created_at: 2026-06-04T19:22:02.188Z
updated_at: 2026-06-04T19:22:02.188Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/web-access/web-search.ts
claim: The web_search tool uses raw fetch for Brave and DuckDuckGo instead of the shared public-target fetcher, so redirects are not revalidated against loopback/private-network targets. The Brave path also sends X-Subscription-Token through this unguarded redirect path.

## Desired Outcome

Route web_search HTTP calls through fetchPublicWebAccessUrl or implement equivalent manual redirect handling: validate each target, reject private-network redirects, and strip provider credentials on cross-origin redirects.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T19-03-34-314Z-security-review-tvqler.

finding id: security-review-web-search-public-target-bypass
candidate id: external-fetch:src/modules/web-access/web-search.ts:65
verdict: confirmed
rationale: Confirmed. src/modules/web-access/web-search.ts:67 and :94 call native fetch directly for Brave and DuckDuckGo; DuckDuckGo explicitly uses redirect: follow at :102, and Brave sends X-Subscription-Token in that raw fetch at :72. This bypasses fetchPublicWebAccessUrl, which validates each redirect target at src/modules/web-access/private-network.ts:68-72 and strips unsafe cross-origin redirect headers at :121.

Evidence:

- src/modules/web-access/web-search.ts:67 - const response = await fetch(url, {
- src/modules/web-access/web-search.ts:72 - "X-Subscription-Token": apiKey,
- src/modules/web-access/web-search.ts:94 - const response = await fetch(searchUrl, {
- src/modules/web-access/private-network.ts:69 - const validation = await validatePublicWebAccessUrl(currentUrl);
- src/modules/web-access/private-network.ts:121 - headers = retainCrossOriginRedirectSafeHeaders(headers);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
