---
id: task-security-review-the-callback-non-local-guard-class
title: Security review: The callback non-local guard classifies only the URL hostname string; ordinary domains are allowed without DNS resolution, and delivery later lets fetch resolve the host, so a callback domain can resolve or rebind to loopback/private addresses and still receive POSTs from KOTA.
status: done
priority: p2
area: security
summary: The callback non-local guard classifies only the URL hostname string; ordinary domains are allowed without DNS resolution, and delivery later lets fetch resolve the host, so a callback domain can resolve or rebind to loopback/private addresses and still receive POSTs from KOTA.
created_at: 2026-06-22T08:06:52.749Z
updated_at: 2026-06-22T08:49:31.588Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/a2a-channel/push-notification-callback-hosts.ts
claim:

> The callback non-local guard classifies only the URL hostname string; ordinary domains are allowed without DNS resolution, and delivery later lets fetch resolve the host, so a callback domain can resolve or rebind to loopback/private addresses and still receive POSTs from KOTA.

## Desired Outcome

> Add delivery-time DNS resolution and private-address rejection, or use a fetch/dispatcher path that pins the resolved public address and rejects redirects or re-resolution to non-public ranges. Add regression coverage for a hostname resolving to private or loopback addresses; a create-time lookup alone is not sufficient.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T06-52-58-889Z-security-review-ajrklr.

finding id: a2a-push-callback-dns-rebinding-ssrf
candidate id: external-fetch:src/modules/a2a-channel/push-notification-callback-hosts.test.ts:31
verdict: confirmed
rationale:

> Confirmed. The callback guard checks only the parsed hostname string and returns false for ordinary domain names. Delivery passes config.url directly to postWithRetry, which calls fetchImpl(url, ...) without DNS resolution, address pinning, post-resolution private-address rejection, or redirect restrictions.

Evidence:

Evidence 1:



path: src/modules/a2a-channel/push-notification-protocol.ts

line: 175

excerpt:



> if (isPrivateCallbackHost(parsed.hostname)) {

Evidence 2:



path: src/modules/a2a-channel/push-notification-callback-hosts.ts

line: 37

excerpt:



> const version = isIP(normalized);

Evidence 3:



path: src/modules/a2a-channel/push-notification-callback-hosts.ts

line: 40

excerpt:



> return false;

Evidence 4:



path: src/modules/a2a-channel/push-notifications.ts

line: 200

excerpt:



> config.url,

Evidence 5:



path: src/modules/notification/index.ts

line: 29

excerpt:



> const res = await fetchImpl(url, {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Resolution

A2A push callback delivery now resolves callback hostnames at delivery time, rejects any loopback/private/non-public resolved address before sending the callback POST, and uses an A2A-owned HTTP(S) dispatcher that pins the connection lookup to the vetted address. The dispatcher does not follow redirects.

## Acceptance Evidence

- Regression coverage in `src/modules/a2a-channel/push-notification-delivery.test.ts` stores an ordinary callback hostname and proves delivery is blocked when the delivery-time resolver returns `127.0.0.1`.
- Verification passed: `pnpm exec vitest run src/modules/a2a-channel/push-notification-callback-hosts.test.ts src/modules/a2a-channel/push-notification-delivery.test.ts src/modules/notification/post-with-retry.test.ts`.
- Verification passed: `pnpm typecheck`.
- Verification passed: `pnpm exec biome check src/modules/a2a-channel/push-notification-callback-delivery.ts src/modules/a2a-channel/push-notification-callback-fetch.ts src/modules/a2a-channel/push-notification-callback-hosts.ts src/modules/a2a-channel/push-notification-delivery.test.ts src/modules/a2a-channel/push-notification-runtime.ts src/modules/a2a-channel/push-notifications.ts`.
