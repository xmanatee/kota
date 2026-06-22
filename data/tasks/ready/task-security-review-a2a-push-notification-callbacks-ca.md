---
id: task-security-review-a2a-push-notification-callbacks-ca
title: Security review: A2A push notification callbacks can be configured with authenticated credentials over plain HTTP; delivery later sends the Authorization header and task update payload to that URL.
status: ready
priority: p2
area: security
summary: A2A push notification callbacks can be configured with authenticated credentials over plain HTTP; delivery later sends the Authorization header and task update payload to that URL.
created_at: 2026-06-22T05:38:58.010Z
updated_at: 2026-06-22T05:38:58.010Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/a2a-channel/push-notification-protocol.ts
claim:

> A2A push notification callbacks can be configured with authenticated credentials over plain HTTP; delivery later sends the Authorization header and task update payload to that URL.

## Desired Outcome

> Require HTTPS for push callback URLs, at least when token or authentication credentials are present, and add regression coverage for rejecting credentialed http:// callbacks.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T04-52-55-867Z-security-review-cts8nz.

finding id: a2a-push-callback-cleartext-auth
candidate id: secret-handling:src/modules/a2a-channel/push-notification-storage.ts:107
verdict: confirmed
rationale:

> Callback URL validation accepts both http: and https: in src/modules/a2a-channel/push-notification-protocol.ts:165-167 without checking whether authentication credentials are present, and delivery attaches Authorization from stored credentials in src/modules/a2a-channel/push-notification-delivery.ts:22-23 before posting to config.url in src/modules/a2a-channel/push-notifications.ts:199-207.

Evidence:

Evidence 1:



path: src/modules/a2a-channel/push-notification-protocol.ts

line: 165

excerpt:



> if (parsed.protocol !== "https:" && parsed.protocol !== "http:")

Evidence 2:



path: src/modules/a2a-channel/push-notification-delivery.ts

line: 22

excerpt:



> if (config.authentication?.credentials) {

Evidence 3:



path: src/modules/a2a-channel/push-notification-delivery.ts

line: 23

excerpt:



> headers.Authorization = `${config.authentication.scheme} ${config.authentication.credentials}`;

Evidence 4:



path: src/modules/a2a-channel/push-notifications.ts

line: 199

excerpt:



> await postWithRetry(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
