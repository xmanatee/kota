---
id: task-security-review-webhook-authentication-signs-only-
title: Security review: Webhook authentication signs only the timestamp and body, while an unsigned `X-Kota-Idempotency-Key` takes precedence when deriving the workflow dispatch key. A captured valid request can therefore be replayed within the five-minute signature window with different idempotency headers; every signature remains valid while durable replay detection sees a distinct delivery. A fresh probe confirmed identical signed bodies produced different dispatch keys.
status: ready
priority: p2
area: security
task_class: Safety
summary: Webhook authentication signs only the timestamp and body, while an unsigned `X-Kota-Idempotency-Key` takes precedence when deriving the workflow dispatch key. A captured valid request can therefore be replayed within the five-minute signature window with different idempotency headers; every signature remains valid while durable replay detection sees a distinct delivery. A fresh probe confirmed identical signed bodies produced different dispatch keys.
created_at: 2026-07-24T19:04:07.858Z
updated_at: 2026-07-24T19:04:07.858Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route-payload.ts
claim:

> Webhook authentication signs only the timestamp and body, while an unsigned `X-Kota-Idempotency-Key` takes precedence when deriving the workflow dispatch key. A captured valid request can therefore be replayed within the five-minute signature window with different idempotency headers; every signature remains valid while durable replay detection sees a distinct delivery. A fresh probe confirmed identical signed bodies produced different dispatch keys.

## Desired Outcome

> Authenticate the idempotency material as part of the HMAC envelope, or stop accepting an unsigned header override and derive replay identity solely from signed body material. Add a route/runtime regression that changes only the idempotency header and proves the delivery is deduplicated.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T18-41-20-702Z-security-review-rg2whe.

finding id: webhook-unsigned-idempotency-header-replay
candidate id: auth-approval-boundary:src/modules/webhook/trigger-route.ts:9
verdict: confirmed
rationale:

> Confirmed. `src/modules/webhook/trigger-route-auth.ts:66` authenticates only the timestamp and raw body, while `src/modules/webhook/trigger-route-payload.ts:93` gives the unsigned idempotency header precedence. `src/core/workflow/workflow-idempotency.ts:72` then uses that derived value as the durable dispatch key. A fresh probe showed the same valid signature remained accepted while two header values produced distinct replay keys.

Evidence:

Evidence 1:



path: src/modules/webhook/trigger-route-auth.ts

line: 71

excerpt:



> return createHmac("sha256", secret)
>     .update(timestamp)
>     .update(".")
>     .update(rawBody)

Evidence 2:



path: src/modules/webhook/trigger-route-payload.ts

line: 98

excerpt:



> const headerKey =
>     trimmedHeader(req, "x-kota-idempotency-key") ??
>     trimmedHeader(req, "idempotency-key");
>   if (headerKey) {
>     return `webhook-header:${hashIdempotencyMaterial([headerKey])}`;

Evidence 3:



path: src/core/workflow/workflow-idempotency.ts

line: 72

excerpt:



> const explicitKey = payloadString(trigger.payload, "idempotencyKey");

Evidence 4:



path: src/core/workflow/workflow-idempotency.ts

line: 77

excerpt:



> if (explicitKey !== undefined) {
>     keyMaterial = [workflowName, trigger.event, explicitKey];

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
