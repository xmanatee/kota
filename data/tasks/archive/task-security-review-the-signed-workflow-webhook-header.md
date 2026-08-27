---
status: done
---

# Security review: The signed workflow webhook header filter still forwards authorization-bearing proxy headers such as x-forwarded-authorization or x-original-authorization. Those names are not exact matches and their suffix is authorization, which is not in the token/key/secret suffix denylist, so a valid signed request can still place bearer credentials into the workflow trigger payload and agent prompt context.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route.ts
claim:

> The signed workflow webhook header filter still forwards authorization-bearing proxy headers such as x-forwarded-authorization or x-original-authorization. Those names are not exact matches and their suffix is authorization, which is not in the token/key/secret suffix denylist, so a valid signed request can still place bearer credentials into the workflow trigger payload and agent prompt context.

## Desired Outcome

> Expand the webhook sensitive-header classifier to reject authorization-suffixed names and common proxy/original credential forwarding headers, then add a regression test proving x-forwarded-authorization and x-original-authorization are omitted while non-sensitive forwarded metadata remains.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-06T16-29-22-229Z-security-review-levyut.

finding id: webhook-forwarded-authorization-header-leak
candidate id: secret-handling:src/modules/webhook/trigger-route.ts:10
verdict: confirmed
rationale:

> Confirmed. src/modules/webhook/trigger-route.ts:45-53 denies exact authorization/cookie/proxy-authorization/x-api-key/x-auth-token names and token/key/secret suffixes, but src/modules/webhook/trigger-route.ts:121-126 does not reject an authorization suffix. src/modules/webhook/trigger-route.ts:170-176 then copies any remaining string header into payload.headers, so x-forwarded-authorization and x-original-authorization would be forwarded into the webhook payload. src/core/workflow/runtime-runs-control.ts:107-110 stores that payload on the workflow trigger, and src/core/workflow/steps/step-executor-agent-prompt.ts:94-110 serializes trigger.payload into the untrusted agent prompt block.

Evidence:

Evidence 1:

path: src/modules/webhook/trigger-route.ts

line: 45

excerpt:

> The exact-name denylist includes authorization and proxy-authorization but does not include common forwarded/original authorization header names.

Evidence 2:

path: src/modules/webhook/trigger-route.ts

line: 53

excerpt:

> SECRET_BEARING_HEADER_SUFFIXES is limited to token, key, and secret, so a header ending in authorization is not rejected by suffix.

Evidence 3:

path: src/modules/webhook/trigger-route.ts

line: 170

excerpt:

> buildPayload copies any string header that is neither internal nor classified as secret-bearing into payload.headers.

Evidence 4:

path: src/core/workflow/runtime-runs-control.ts

line: 107

excerpt:

> enqueueWebhookRun stores the webhook payload directly in the WorkflowRunTrigger payload with only _runId added.

Evidence 5:

path: src/core/workflow/steps/step-executor-agent-prompt.ts

line: 94

excerpt:

> buildUntrustedTriggerPayloadBlock serializes trigger.payload into the agent prompt's untrusted trigger block.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/webhook/trigger-route.test.ts`
- `pnpm exec biome check src/modules/webhook/trigger-route.ts src/modules/webhook/trigger-route.test.ts`
