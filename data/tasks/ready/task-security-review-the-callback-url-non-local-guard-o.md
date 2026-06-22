---
id: task-security-review-the-callback-url-non-local-guard-o
title: Security review: The callback URL non-local guard only blocks localhost names and private dotted IPv4 ranges; private or link-local IPv6 literals and IPv4-mapped loopback literals are treated as allowed callback hosts and later fetched.
status: ready
priority: p2
area: security
summary: The callback URL non-local guard only blocks localhost names and private dotted IPv4 ranges; private or link-local IPv6 literals and IPv4-mapped loopback literals are treated as allowed callback hosts and later fetched.
created_at: 2026-06-22T05:38:58.024Z
updated_at: 2026-06-22T05:38:58.024Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/a2a-channel/push-notification-protocol.ts
claim:

> The callback URL non-local guard only blocks localhost names and private dotted IPv4 ranges; private or link-local IPv6 literals and IPv4-mapped loopback literals are treated as allowed callback hosts and later fetched.

## Desired Outcome

> Extend callback host validation to reject private, loopback, link-local, and IPv4-mapped IPv6 address literals, and consider resolving DNS to reject private resolved addresses before delivery.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T04-52-55-867Z-security-review-cts8nz.

finding id: a2a-push-callback-private-ipv6-ssrf
candidate id: external-fetch:src/modules/a2a-channel/push-notification-test-helpers.ts:229
verdict: confirmed
rationale:

> The private-host guard only special-cases localhost/.local/::1 and dotted IPv4 ranges in src/modules/a2a-channel/push-notification-protocol.ts:176-195. Other IPv6 literals such as [fd00::1], [fe80::1], and IPv4-mapped loopback/private forms are not parsed as IPv4 and therefore pass through to delivery via config.url.

Evidence:

Evidence 1:



path: src/modules/a2a-channel/push-notification-protocol.ts

line: 171

excerpt:



> if (isPrivateCallbackHost(parsed.hostname)) {

Evidence 2:



path: src/modules/a2a-channel/push-notification-protocol.ts

line: 187

excerpt:



> const ipv4 = parseIpv4(normalized);

Evidence 3:



path: src/modules/a2a-channel/push-notification-protocol.ts

line: 188

excerpt:



> if (!ipv4) return false;

Evidence 4:



path: src/modules/a2a-channel/push-notifications.ts

line: 200

excerpt:



> config.url,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
