---
id: task-security-review-the-optional-webhook-anti-replay-t
title: Security review: The optional webhook anti-replay timestamp is validated independently of the HMAC signature. Because the signature covers only the raw body, a captured signed body can be resent with a fresh X-Kota-Webhook-Timestamp; the five-minute timestamp check is therefore not cryptographic replay protection when dispatch idempotency has no prior accepted entry or after its retention window expires.
status: ready
priority: p2
area: security
task_class: Safety
summary: The optional webhook anti-replay timestamp is validated independently of the HMAC signature. Because the signature covers only the raw body, a captured signed body can be resent with a fresh X-Kota-Webhook-Timestamp; the five-minute timestamp check is therefore not cryptographic replay protection when dispatch idempotency has no prior accepted entry or after its retention window expires.
created_at: 2026-07-06T16:40:19.048Z
updated_at: 2026-07-06T16:40:19.048Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route.ts
claim:

> The optional webhook anti-replay timestamp is validated independently of the HMAC signature. Because the signature covers only the raw body, a captured signed body can be resent with a fresh X-Kota-Webhook-Timestamp; the five-minute timestamp check is therefore not cryptographic replay protection when dispatch idempotency has no prior accepted entry or after its retention window expires.

## Desired Outcome

> Version the webhook signature scheme so replay-protected deliveries sign both timestamp and raw body, for example HMAC over '<timestamp>.<rawBody>', and reject missing or stale timestamps for that scheme. Document body-only signatures as authentication without timestamp anti-replay, or require the signed timestamp for all workflow webhooks after a compatibility window.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-06T16-29-22-229Z-security-review-levyut.

finding id: webhook-timestamp-not-signed
candidate id: auth-approval-boundary:src/modules/webhook/trigger-route.ts:8
verdict: confirmed
rationale:

> Confirmed. src/modules/webhook/trigger-route.ts:82-84 computes the HMAC over rawBody only, while src/modules/webhook/trigger-route.ts:225-229 validates X-Kota-Webhook-Timestamp separately when present. The CLI guidance at src/modules/webhook/cli.ts:68-83 describes the timestamp as optional replay protection, but because the timestamp is not signed a captured valid body signature can be paired with a fresh timestamp. Runtime idempotency narrows duplicate dispatch during retention because webhook idempotency keys are fingerprinted separately and webhook receive timestamp is excluded at src/core/workflow/workflow-idempotency.ts:87-107, but idempotency retention defaults to seven days at src/core/daemon/idempotency-store.ts:89-92 and expired entries can be accepted as fresh work after the expiry path at src/core/daemon/idempotency-store.ts:162-169.

Evidence:

Evidence 1:



path: src/modules/webhook/trigger-route.ts

line: 82

excerpt:



> verifySignature computes createHmac("sha256", secret).update(rawBody), so the timestamp header is not part of the signed material.

Evidence 2:



path: src/modules/webhook/trigger-route.ts

line: 225

excerpt:



> The handler reads x-kota-webhook-timestamp separately and accepts the request when that standalone header is inside the local time window.

Evidence 3:



path: src/modules/webhook/cli.ts

line: 79

excerpt:



> The generated-secret help describes X-Kota-Webhook-Timestamp as optional replay protection with a five-minute rejection window.

Evidence 4:



path: src/core/daemon/idempotency-store.ts

line: 89

excerpt:



> Workflow dispatch idempotency defaults to expire-after-ms retention of seven days, so it is a duplicate-dispatch guard rather than permanent replay prevention.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
