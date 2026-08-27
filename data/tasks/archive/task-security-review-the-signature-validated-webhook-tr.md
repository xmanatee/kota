---
status: done
---

# Security review: The signature-validated webhook trigger forwards arbitrary inbound headers into workflow trigger payloads without filtering common secret-bearing headers, so Authorization/Cookie/API-token material can be persisted in run artifacts and exposed to agent prompts.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/webhook/trigger-route.ts
claim:

> The signature-validated webhook trigger forwards arbitrary inbound headers into workflow trigger payloads without filtering common secret-bearing headers, so Authorization/Cookie/API-token material can be persisted in run artifacts and exposed to agent prompts.

## Desired Outcome

> Filter or redact sensitive webhook request headers before dispatch, at least authorization, cookie, set-cookie, proxy-authorization, x-api-key, x-auth-token, and token/key/secret-suffixed headers; add a trigger-route regression test proving these headers are absent from the dispatcher payload while non-sensitive headers remain.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-06T15-22-58-349Z-security-review-it7uev.

finding id: webhook-sensitive-headers-persisted
candidate id: secret-handling:src/core/workflow/trigger-types.ts:156
verdict: confirmed
rationale:

> buildPayload in src/modules/webhook/trigger-route.ts:143-151 forwards every string request header except the Kota signature/timestamp/idempotency headers. enqueueWebhookRun preserves that payload in the WorkflowRunTrigger at src/core/workflow/runtime-runs-control.ts:107-110, webhook runs expose it as stepOutputs.trigger at src/core/workflow/run-executor.ts:143-146, and buildAgentPrompt serializes trigger.payload into the agent prompt without redaction at src/core/workflow/steps/step-executor-agent-prompt.ts:94-97. Authorization/Cookie/x-api-key style headers from a valid signed request can therefore reach agent context. The run-artifact persistence portion is narrower than claimed because trigger/metadata storage uses evidence projection and redacts provider-payload fields such as headers.

Evidence:

Evidence 1:

path: src/modules/webhook/trigger-route.ts

line: 142

excerpt:

> buildPayload copies every string request header except x-kota-webhook-signature, x-kota-webhook-timestamp, x-kota-idempotency-key, and idempotency-key into payload.headers.

Evidence 2:

path: src/core/workflow/runtime-runs-control.ts

line: 107

excerpt:

> enqueueWebhookRun stores the webhook payload directly in the WorkflowRunTrigger payload with only _runId added.

Evidence 3:

path: src/core/workflow/run-store-creation.ts

line: 59

excerpt:

> createWorkflowRun writes trigger.json and also embeds the trigger in metadata.json for the run.

Evidence 4:

path: src/core/workflow/steps/step-executor-agent-prompt.ts

line: 94

excerpt:

> buildUntrustedTriggerPayloadBlock serializes the full trigger payload into the agent prompt's untrusted trigger block.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification: `pnpm test src/modules/webhook/trigger-route.test.ts` passed with 15 tests.
