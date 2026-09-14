---
status: done
---
# Security review: Injection-defense ignores structuredContent even for results carrying external MCP provenance. Identical override text is flagged and annotated in ordinary content but assessed as clean in structured strings or objects, which then reach model projection without the warning.

security family: 18184b268ec86666f30913f3fff872383b775915cfdb554000e82f5fc4e34d9e


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/injection-defense/defense-middleware.ts
claim:

> Injection-defense ignores structuredContent even for results carrying external MCP provenance. Identical override text is flagged and annotated in ordinary content but assessed as clean in structured strings or objects, which then reach model projection without the warning.

## Desired Outcome

> Include model-visible structured JSON in the existing result-screening projection and ensure suspicious structured payloads receive an effective untrusted-content annotation at model projection. Preserve original data and existing tool-risk gates.

> Repair payload selection and annotation at the existing injection-defense owner. Verify equivalent suspicious text across ordinary and structured representations, including the resulting model projection. Keep this separate from credential masking and earlier browser target-admission repairs.

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

security evidence: e045b4863a636e7f925fcad8e29ffec84ce480683da27aa2cc534a76e9dbab5e
evidence identity: mcp-structured-content-omitted-from-injection-screening-v1
production owner: src/modules/injection-defense/defense-middleware
violated invariant: model-visible-external-tool-content-screened
Common repair:
> Include model-visible structured JSON in the existing result-screening projection and ensure suspicious structured payloads receive an effective untrusted-content annotation at model projection. Preserve original data and existing tool-risk gates.
Exploit preconditions:
> An attacker controls a successful MCP result consumed by an autonomous session with injection-defense enabled. The attacker places instructions only in structuredContent while ordinary content is innocuous. The model adapter exposes structured JSON. Probes establish bypass of assessment and annotation; model obedience and unauthorized tool execution were not tested.
finding id: structured-mcp-result-injection-screening-bypass
candidate id: auth-approval-boundary:src/core/tools/tool-result.ts:1
verdict: confirmed
rationale:

> External MCP provenance activates injection screening, but resultScreeningText omits structuredContent. Independent middleware-to-projection probes assessed structured instruction strings and objects as clean and exposed them without annotations; identical ordinary text was flagged and annotated. This confirms a screening bypass when injection-defense is enabled for the session, not model obedience or unauthorized execution. Including structured data in screening and effective annotation addresses this distinct omission; the earlier browser target-admission repair does not.

Evidence:

Evidence 1:



path: src/modules/injection-defense/defense-middleware.ts

line: 97

excerpt:



> function resultScreeningText(result: ToolResult): string {
>   if (!result.blocks) return result.content;
>   const blockText = result.blocks.map(blockScreeningText).filter(Boolean);
>   if (blockText.length === 0) return result.content;
>   return [result.content, ...blockText].join("\n");
> }

Evidence 2:



path: src/modules/injection-defense/defense-middleware.ts

line: 147

excerpt:



> const verdict = detectInjection(resultScreeningText(result));
> emit({
>   tool: call.name,
>   suspicious: verdict.suspicious,
>   reasons: verdict.reasons,
>   action: verdict.suspicious ? "annotate" : "skip",

Evidence 3:



path: src/modules/injection-defense/defense-middleware.ts

line: 156

excerpt:



> if (!verdict.suspicious) return result;

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

Fixed at the injection-defense middleware owner. Screening now includes
structured JSON and decoded strings/keys, so JSON escaping cannot hide the
same whitespace-sensitive instructions detected in ordinary content. The
warning explicitly covers the entire result, including structured data that
model adapters append outside the ordinary text markers. Original structured
values and rich blocks are preserved. Tool-risk, approval, credential masking,
and existing screening eligibility remain unchanged.

## Verification

- `pnpm test:integration src/injection-defense-projection.integration.test.ts`:
  9 cases passed. The public middleware-to-model projection boundary checks
  equivalent ordinary/structured instructions, nested objects, arrays, keys,
  escaped whitespace, absent/empty/rich blocks, unchanged source data, and
  benign null/false/zero/empty values. It detects both omitted screening and
  a warning that excludes the appended structured payload.
- `pnpm test:owner src/modules/injection-defense src/modules/model-clients/openai/tool-result-projection.test.ts src/modules/tracing/security-logs-mcp-injection.test.ts`:
  32 tests passed across 5 files, covering existing annotation, eligibility,
  assessment logging, and projection behavior.
- All `pnpm check:fast` components passed: production/test typechecking,
  lint, task validation, generated client bindings, and module admission.
  The initial combined command stopped at new-test import ordering; lint and
  subsequent components passed after correcting it.
- A synthetic baseline/candidate probe produced 8 passing observations through
  the real middleware and model projection. Baseline structured string/object
  cases were clean and unannotated; the candidate marks them suspicious with
  a whole-result warning. Ordinary attack and benign controls behaved as
  expected. Evidence: builder run `2026-09-14T00-31-17-192Z-builder-tx41to`,
  `artifacts/structured-screening-probe.json` (baseline commit and rendered
  projections included).

This verifies assessment, annotation, and data preservation. It does not claim
live model obedience or prevention of unauthorized tool execution; no live model
was invoked. Full repository build/test partitions were not run for this local
middleware change.
