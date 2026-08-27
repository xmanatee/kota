---
status: done
---

# Security review: External fetch consumers read arbitrary public response bodies with response.text() or arrayBuffer() before enforcing max_length or max_response_length, so a hostile endpoint can force unbounded memory use and crash or stall the agent/daemon process.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/web-access/private-network.ts
claim: External fetch consumers read arbitrary public response bodies with response.text() or arrayBuffer() before enforcing max_length or max_response_length, so a hostile endpoint can force unbounded memory use and crash or stall the agent/daemon process.

## Desired Outcome

Enforce byte limits while streaming response bodies, including save_to paths, before allocating full strings or buffers. Reject oversized Content-Length early when present, abort chunked responses once the cap is exceeded, and add tests for oversized text, JSON, and binary responses.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-19T11-54-17-527Z-security-review-kgrsnn.

finding id: external-fetch-unbounded-response-body
candidate id: external-fetch:src/modules/web-access/private-network.ts:164
verdict: confirmed
rationale: fetchPublicWebAccessUrl wraps the Node response stream directly in a Response without a byte limit at src/modules/web-access/private-network.ts:177-180. runWebFetch consumes save_to downloads with response.arrayBuffer() or response.text() at src/modules/web-access/web-fetch.ts:137-145, and consumes normal text/JSON with response.text() before applying max_length truncation at src/modules/web-access/web-fetch.ts:169-190. runHttpRequest has the same save_to pattern at src/modules/web-access/http-request.ts:162-169 and reads response.text() before max_response_length truncation at src/modules/web-access/http-request.ts:200-219. The timeout bounds duration, but it does not bound bytes allocated from a fast oversized response or from an oversized Content-Length response.

Evidence:

- src/modules/web-access/private-network.ts:177 - const responseBody = responseBodyAllowed(status) ? Readable.toWeb(response) as ReadableStream<Uint8Array> : null;
- src/modules/web-access/web-fetch.ts:169 - const raw = await response.text();
- src/modules/web-access/web-fetch.ts:186 - if (text.length > maxLength) {
- src/modules/web-access/http-request.ts:200 - const raw = await response.text();
- src/modules/web-access/http-request.ts:215 - if (bodyText.length > maxResponse) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/web-access/web-fetch.test.ts src/modules/web-access/http-request.test.ts src/modules/web-access/web-search.test.ts` passed with 165 tests.
- `pnpm typecheck` passed.
- `pnpm lint` exited 0; it reported an unrelated pre-existing unused-import warning in `src/modules/workflow-ops/simulation/engine.ts`.
