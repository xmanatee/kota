---
id: task-security-review-the-private-network-guard-validate
title: Security review: The private-network guard validates a hostname with a separate DNS lookup, then performs fetch against the original hostname, so DNS rebinding can make the actual connection target a loopback or private address after validation passes.
status: done
priority: p1
area: security
summary: The private-network guard validates a hostname with a separate DNS lookup, then performs fetch against the original hostname, so DNS rebinding can make the actual connection target a loopback or private address after validation passes.
created_at: 2026-05-26T22:47:53.840Z
updated_at: 2026-05-26T23:19:03.110Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/web-access/private-network.ts
claim: The private-network guard validates a hostname with a separate DNS lookup, then performs fetch against the original hostname, so DNS rebinding can make the actual connection target a loopback or private address after validation passes.

## Desired Outcome

Bind the actual HTTP connection to the validated public address, or use a custom dispatcher/lookup hook that rejects private addresses at connection time for every request and redirect.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T22-42-30-144Z-security-review-brqdwt.

finding id: security-review-web-access-dns-rebinding-private-network-bypass
candidate id: external-fetch:src/modules/web-access/private-network.ts:84
verdict: confirmed
rationale: The code resolves and validates the hostname in a separate preflight lookup, then calls fetch with the original URL. There is no dispatcher, lookup hook, or address binding that guarantees the actual connection target is one of the validated public addresses.

Evidence:

- src/modules/web-access/private-network.ts:44 - const addresses = await lookup(hostname, { all: true, verbatim: true });
- src/modules/web-access/private-network.ts:73 - const validation = await validatePublicWebAccessUrl(currentUrl);
- src/modules/web-access/private-network.ts:84 - const response = await fetch(currentUrl, requestInit);

## Resolution

`fetchPublicWebAccessUrl` now performs outbound requests through Node's
`http.request` / `https.request` with a custom connection-time `lookup`
function. The lookup validates the address family selected for the actual
socket and rejects loopback/private-network addresses before the request is
issued, including after redirects.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/web-access/http-request.test.ts src/modules/web-access/web-fetch.test.ts src/web-fetch-extract.integration.test.ts src/http-data-pipeline.integration.test.ts --pool=forks --maxWorkers=1` passed: 4 files, 135 tests.
- `pnpm typecheck` passed.
- `pnpm exec biome check src/modules/web-access/private-network.ts src/modules/web-access/http-request.test.ts src/web-fetch-extract.integration.test.ts test/loopback-fetch.ts` passed.
