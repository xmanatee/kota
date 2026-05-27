---
id: task-security-review-the-web-access-private-network-gua
title: Security review: The web-access private-network guard blocks IPv4 private ranges and some IPv6 local ranges, but the IPv6 check omits site-local and other non-public IPv6 ranges such as `fec0::/10`, allowing `web_fetch` or `http_request` to target private IPv6 services when such routing exists.
status: done
priority: p3
area: security
summary: The web-access private-network guard blocks IPv4 private ranges and some IPv6 local ranges, but the IPv6 check omits site-local and other non-public IPv6 ranges such as `fec0::/10`, allowing `web_fetch` or `http_request` to target private IPv6 services when such routing exists.
created_at: 2026-05-27T03:03:14.153Z
updated_at: 2026-05-27T03:25:12.530Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/web-access/private-network.ts
claim: The web-access private-network guard blocks IPv4 private ranges and some IPv6 local ranges, but the IPv6 check omits site-local and other non-public IPv6 ranges such as `fec0::/10`, allowing `web_fetch` or `http_request` to target private IPv6 services when such routing exists.

## Desired Outcome

Expand IPv6 target classification to reject non-global/private ranges consistently, including site-local and multicast/reserved ranges where relevant, and add focused tests for literal and DNS-resolved IPv6 addresses.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T02-52-17-351Z-security-review-mykpa4.

finding id: web-access-private-ipv6-range-bypass
candidate id: external-fetch:src/modules/web-access/private-network.ts:39
verdict: confirmed
rationale: src/modules/web-access/private-network.ts rejects IPv6 unspecified, loopback, IPv4-mapped private, unique-local, and link-local addresses, but does not reject site-local fec0::/10 or other non-global IPv6 ranges. A local validation probe returned ok for http://[fec0::1]/ and http://[ff02::1]/ while blocking fc00::1 and fe80::1, so both literal and DNS-resolved targets in those omitted ranges can pass the guard.

Evidence:

- src/modules/web-access/private-network.ts:299 - function validateLiteralHost(hostname: string): WebAccessTargetValidation {
- src/modules/web-access/private-network.ts:305 - if (version !== 0 && isLoopbackOrPrivateAddress(hostname)) {
- src/modules/web-access/private-network.ts:346 - function isPrivateIpv6(hostname: string): boolean {
- src/modules/web-access/private-network.ts:357 - const uniqueLocal = (firstByte & 0xfe) === 0xfc; const linkLocal = firstHextet >= 0xfe80 && firstHextet <= 0xfebf; return uniqueLocal || linkLocal;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion Evidence

- Added `src/modules/web-access/private-network.test.ts` coverage for literal
  and DNS-resolved non-public IPv6 targets, including `fec0::/10` and
  multicast addresses.
- Verification: `pnpm test src/modules/web-access/private-network.test.ts src/modules/web-access/web-fetch.test.ts src/modules/web-access/http-request.test.ts`
- Verification: `pnpm exec biome check src/modules/web-access/private-network.ts src/modules/web-access/private-network.test.ts`
- Verification: `pnpm typecheck`
