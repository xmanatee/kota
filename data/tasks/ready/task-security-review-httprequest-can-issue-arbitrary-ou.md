---
id: task-security-review-httprequest-can-issue-arbitrary-ou
title: Security review: http_request can issue arbitrary outbound HTTP/HTTPS GET requests, but guardrails force GET to safe, bypassing passive/supervised approval for open-world network access.
status: ready
priority: p2
area: security
summary: http_request can issue arbitrary outbound HTTP/HTTPS GET requests, but guardrails force GET to safe, bypassing passive/supervised approval for open-world network access.
created_at: 2026-05-25T23:36:19.121Z
updated_at: 2026-05-25T23:36:19.121Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/tools/guardrails-classify.ts
claim: http_request can issue arbitrary outbound HTTP/HTTPS GET requests, but guardrails force GET to safe, bypassing passive/supervised approval for open-world network access.

## Desired Outcome

Treat http_request GET as at least moderate open-world network access, preserving save_to escalation, and update guardrail/autonomy tests so supervised queues and passive blocks arbitrary external GETs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-25T23-29-14-103Z-security-review-iggnok.

finding id: security-review-http-get-safe-external-network
candidate id: external-fetch:src/modules/web-access/http-request.ts:124
verdict: confirmed
rationale: Current code still allows any http:// or https:// URL and executes fetch with caller-supplied headers, while guardrails special-case GET to safe after only checking save_to. The web-access module itself describes these as open-world network capabilities, and safe assessments still bypass passive and supervised autonomy gates.

Evidence:

- src/modules/web-access/http-request.ts:124 - response = await fetch(url, fetchOptions);
- src/core/tools/guardrails-classify.ts:449 - // http_request: GET keeps the safe-tier baseline; mutating methods are moderate.
- src/core/tools/guardrails-classify.ts:455 - return { risk: "safe", reason: "HTTP GET request" };
- src/modules/web-access/index.ts:10 - * web_search and web_fetch are open-world reads (moderate risk via
- src/core/tools/autonomy-mode.ts:47 - if (assessment.risk === "safe") return { action: "allow" };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
