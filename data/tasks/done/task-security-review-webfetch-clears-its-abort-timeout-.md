---
id: task-security-review-webfetch-clears-its-abort-timeout-
title: Security review: web_fetch clears its abort timeout immediately after response headers, so an untrusted server can stall body reads or downloads beyond the intended 30 second bound.
status: done
priority: p3
area: security
summary: web_fetch clears its abort timeout immediately after response headers, so an untrusted server can stall body reads or downloads beyond the intended 30 second bound.
created_at: 2026-05-26T02:57:24.711Z
updated_at: 2026-05-26T03:07:20.300Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/web-access/web-fetch.ts
claim: web_fetch clears its abort timeout immediately after response headers, so an untrusted server can stall body reads or downloads beyond the intended 30 second bound.

## Desired Outcome

Keep the AbortController timeout active until every body read, binary cancel, and save_to write path has completed or failed, matching http_request's body-read timeout behavior, and add regression coverage for a body-read AbortError.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T02-51-14-842Z-security-review-j7pal6.

finding id: web-fetch-body-timeout-cleared
candidate id: external-fetch:src/modules/web-access/web-fetch.ts:92
verdict: confirmed
rationale: The timeout is armed before fetch but cleared immediately after fetch resolves at headers. Later response.text() calls in save_to and normal response handling run without an active timer, so a server that sends headers and stalls the body can exceed the intended 30 second bound. The sibling http_request implementation keeps its timeout active through body reads and has regression coverage for body-read AbortError, while web_fetch only covers AbortError from fetch itself.

Evidence:

- src/modules/web-access/web-fetch.ts:104 - const controller = new AbortController();
- src/modules/web-access/web-fetch.ts:105 - const timeout = setTimeout(() => controller.abort(), 30_000);
- src/modules/web-access/web-fetch.ts:116 - clearTimeout(timeout);
- src/modules/web-access/web-fetch.ts:139 - const text = await response.text();
- src/modules/web-access/web-fetch.ts:163 - const raw = await response.text();

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/modules/web-access/web-fetch.test.ts` passed with regression coverage for body-read AbortError and timeout lifetime across body reads, binary cancellation, and `save_to` writes.
- `pnpm test src/modules/web-access` passed.
- `pnpm exec biome check src/modules/web-access/web-fetch.ts src/modules/web-access/web-fetch.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm validate-tasks` passed.
