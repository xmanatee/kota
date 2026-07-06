---
id: task-security-review-the-signature-validated-webhook-co
title: Security review: The signature-validated webhook control route bypasses daemon bearer auth but buffers the entire request body before checking that a signature header exists, and the shared body reader has no byte limit. An unauthenticated caller that can reach the daemon listener can send an oversized body to /webhooks/:name and force unbounded memory allocation before the request is rejected.
status: done
priority: p2
area: security
task_class: Safety
summary: The signature-validated webhook control route bypasses daemon bearer auth but buffers the entire request body before checking that a signature header exists, and the shared body reader has no byte limit. An unauthenticated caller that can reach the daemon listener can send an oversized body to /webhooks/:name and force unbounded memory allocation before the request is rejected.
created_at: 2026-07-06T18:04:37.550Z
updated_at: 2026-07-06T20:27:34.184Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route.ts
claim:

> The signature-validated webhook control route bypasses daemon bearer auth but buffers the entire request body before checking that a signature header exists, and the shared body reader has no byte limit. An unauthenticated caller that can reach the daemon listener can send an oversized body to /webhooks/:name and force unbounded memory allocation before the request is rejected.

## Desired Outcome

> Move cheap authentication prechecks before body buffering where possible, replace the webhook route's body read with a capped reader that aborts oversized payloads with 413, and add a regression test proving an unsigned oversized webhook request is rejected without buffering or reaching the dispatcher.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-06T17-54-22-917Z-security-review-xzoj1i.

finding id: webhook-bypass-route-unbounded-preauth-body
candidate id: daemon-control-route:src/modules/webhook/trigger-route.ts:24
verdict: confirmed
rationale:

> Confirmed. The webhook route is registered with bypassAuth: true at src/modules/webhook/trigger-route.ts:170-174, and the daemon skips bearer authorization for bypassed control routes before invoking the handler at src/core/daemon/daemon-control.ts:251-268. The handler reads the full body with readBody at src/modules/webhook/trigger-route.ts:78-80 before checking X-Kota-Webhook-Signature at src/modules/webhook/trigger-route.ts:86-89. That reader appends all chunks and Buffer.concat's them with no byte cap at src/core/daemon/daemon-control-utils.ts:13-18, so an unsigned oversized request can consume memory before rejection.

Evidence:

Evidence 1:



path: src/modules/webhook/trigger-route.ts

line: 78

excerpt:



> The handler reads rawBody with await readBody(req) before looking at X-Kota-Webhook-Signature.

Evidence 2:



path: src/modules/webhook/trigger-route.ts

line: 86

excerpt:



> The signature header is checked only after the full request body has already been buffered.

Evidence 3:



path: src/core/daemon/daemon-control-utils.ts

line: 13

excerpt:



> readBody pushes every incoming chunk into an array and resolves Buffer.concat(chunks) without a size cap.

Evidence 4:



path: src/modules/webhook/trigger-route.ts

line: 170

excerpt:



> webhookTriggerControlRoutes registers POST /webhooks/:name with bypassAuth: true.

## Resolution

- `POST /webhooks/:name` now rejects missing signatures, missing workflow secrets, and malformed signature/timestamp metadata before reading the request body.
- Signed webhook bodies are read through the shared daemon body reader with the webhook route's `WEBHOOK_TRIGGER_BODY_LIMIT_BYTES` cap; over-cap payloads return 413 and do not reach the dispatcher.
- Regression coverage proves unsigned oversized requests do not attach body readers, and signed over-cap requests return 413 without dispatching.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/modules/webhook/trigger-route.test.ts src/modules/webhook/trigger-route-security.test.ts` passed.
- `pnpm exec biome check src/core/daemon/daemon-control-utils.ts src/modules/webhook/trigger-route.ts src/modules/webhook/trigger-route-auth.ts src/modules/webhook/trigger-route-security.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm run validate-tasks` passed after final staging.
