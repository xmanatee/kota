---
status: done
---
# Security review: The shared tool-result masker masks ordinary text but copies structuredContent unchanged. A peer can return a known credential as structured JSON and expose it to the model despite successful masking of the identical text result. Probes reproduced this for strings, objects and arrays.

security family: 40e76c6c0308d2eb903e1ad34f10962eefa80c4fdbd8db98e7df46f16e5a890e


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/tools/secret-masking.ts
claim:

> The shared tool-result masker masks ordinary text but copies structuredContent unchanged. A peer can return a known credential as structured JSON and expose it to the model despite successful masking of the identical text result. Probes reproduced this for strings, objects and arrays.

## Desired Outcome

> Extend the shared tool-result masker to cover structured JSON exposed to agents, including scalar strings and nested strings in objects and arrays. Preserve schema validation against authoritative results before producing the masked projection.

> Repair structured-result masking at its shared owner and verify the real runner-to-model boundary with known synthetic credentials and nonsecret controls. Keep this separate from MCP diagnostic redaction and historical filesystem-read protections. Retained probes demonstrate the distinct omission.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-13T23-55-45-889Z-security-review-3g7v1l.

Confirmed by security-review workflow runs:

- 2026-09-13T23-55-45-889Z-security-review-3g7v1l

security evidence: 4de99b86e08318ba396da33430124cd434bad5dc677b096758dd75d5fc9cd46d
evidence identity: structured-tool-result-known-secret-echo-v1
production owner: src/core/tools/secret-masking
violated invariant: known-secrets-masked-before-agent-result-publication
Common repair:
> Extend the shared tool-result masker to cover structured JSON exposed to agents, including scalar strings and nested strings in objects and arrays. Preserve schema validation against authoritative results before producing the masked projection.
Exploit preconditions:
> A configured MCP peer or external tool result contains a credential already registered with KOTA's secret store. The tool executes successfully and its structured result reaches a model-facing projection. The probe registered only a synthetic credential and exercised the real client, manager, runner, masker and projection with controlled external ports.
finding id: structured-tool-result-known-secret-disclosure
candidate id: secret-handling:src/core/tools/tool-runner-execution.ts:4
verdict: confirmed
rationale:

> The shared masker processes content and text blocks but preserves structuredContent unchanged. Probes through the real MCP client, manager, runner and model projection disclosed a registered synthetic credential in scalar strings, nested objects and arrays while masking identical ordinary text. This requires a successful external result containing a known credential and a consumer projecting structured results. Extending masking to structured JSON addresses this omission; historical filesystem-read protections and MCP diagnostic repairs do not.

Evidence:

Evidence 1:



path: src/core/tools/secret-masking.ts

line: 9

excerpt:



> export function maskToolResultSecrets<T extends MaskableToolResult>(result: T): T {
>   const content = maskKnownSecretValues(result.content);
>   const blocks = result.blocks?.map((block) =>
>     block.type === "text"
>       ? { ...block, text: maskKnownSecretValues(block.text) }
>       : block,
>   );

Evidence 2:



path: src/core/tools/secret-masking.ts

line: 17

excerpt:



> return {
>   ...result,
>   content,
>   ...(blocks ? { blocks } : {}),
> } as T;

Evidence 3:



path: src/core/tools/tool-runner-execution.ts

line: 216

excerpt:



> return maskToolResultSecrets({
>   ...result,
>   content: truncateToolResult(result.content, resultLimit),
>   blocks,
> });

Evidence 4:



path: src/modules/model-clients/openai/tool-result-projection.ts

line: 25

excerpt:



> if (block.structuredContent !== undefined) {
>   sections.push(
>     `[structuredContent]\n${stableJsonStringify(block.structuredContent)}`,
>   );
> }


## Resolution

The shared tool-result masker now recursively masks registered secret values in
structured scalar strings, object values and keys, and arrays. It preserves
nonsecret JSON values and creates a separate projection. Authoritative output
schema validation remains upstream of masking.

Verification:

- `pnpm test:integration src/structured-result-masking.integration.test.ts`:
  the original implementation failed all three credential-bearing variants
  (scalar, object, array), while six nonsecret controls passed. After the repair,
  all nine cases pass through the real MCP client, manager, runner and OpenAI
  model projection with a synthetic credential containing JSON escape characters.
  Exact-value output schemas establish validation precedes masking; invalid
  responses are still rejected without exposing their structured payloads.
- `pnpm test:owner src/core/tools/tool-runner-schema.test.ts src/core/tools/tool-runner-execution-part-3.test.ts src/modules/model-clients/openai/tool-result-projection.test.ts`:
  24 tests pass, covering existing output validation, runner result preservation,
  scheduling and provider projection behavior.
- `pnpm check:fast`: passed production/test typechecking, lint, task validation,
  generated client binding checks and bundled module admission.

The controlled peer HTTP port and isolated synthetic secret store avoid live
credentials. No live model request is needed to inspect the exact model-facing
projection; deployment and publication remain runtime-owned.
