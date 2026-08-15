---
id: task-security-review-browser-navigation-and-article-rea
title: Security review: Browser navigation and article-reading tools send arbitrary HTTP(S) URLs directly to Playwright without the shared public-untrusted target, redirect, or DNS-rebinding checks. An autonomous browser-enabled session can therefore read loopback, private-network, or link-local services and return their contents to the agent.
status: ready
priority: p1
area: security
task_class: Safety
summary: Browser navigation and article-reading tools send arbitrary HTTP(S) URLs directly to Playwright without the shared public-untrusted target, redirect, or DNS-rebinding checks. An autonomous browser-enabled session can therefore read loopback, private-network, or link-local services and return their contents to the agent.
created_at: 2026-08-15T13:48:20.966Z
updated_at: 2026-08-15T13:48:20.966Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/browser/tools.ts
claim:

> Browser navigation and article-reading tools send arbitrary HTTP(S) URLs directly to Playwright without the shared public-untrusted target, redirect, or DNS-rebinding checks. An autonomous browser-enabled session can therefore read loopback, private-network, or link-local services and return their contents to the agent.

## Desired Outcome

> Route all browser traffic through a connection-boundary policy that rejects non-public destinations and revalidates redirects and DNS results, including subresource requests. Require an explicit operator-selected profile for any legitimate private target and add focused loopback, private-address, redirect, and rebinding rejection tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T12-02-42-516Z-security-review-6w7fq1.

finding id: browser-private-network-policy-bypass
candidate id: external-fetch:src/modules/browser/tools.ts:42
verdict: confirmed
rationale:

> Browser navigation validates only the HTTP(S) prefix before passing the URL directly to Playwright page.goto. The browser module does not invoke the shared outbound target policy or install request interception for initial navigation, redirects, or subresources, so loopback, private, and link-local destinations remain reachable.

Evidence:

Evidence 1:



path: src/modules/browser/tools.ts

line: 42

excerpt:



> if (!url.startsWith("http://") && !url.startsWith("https://")) {

Evidence 2:



path: src/modules/browser/tools.ts

line: 51

excerpt:



> await page.goto(url, {

Evidence 3:



path: src/modules/browser/tools.ts

line: 592

excerpt:



> await page.goto(url, { waitUntil: "domcontentloaded", timeout });

Evidence 4:



path: src/modules/browser/tools.ts

line: 606

excerpt:



> const extract = (await page.evaluate(buildArticleExtractScript(selectorHint))) as {

Evidence 5:



path: src/core/outbound-http/network-policy.ts

line: 96

excerpt:



> const blocked = addresses.find((address) => isNonPublicAddress(normalizeHostname(address.address)));

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
