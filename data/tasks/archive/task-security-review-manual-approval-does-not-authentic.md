---
status: done
---

# Security review: Manual approval does not authenticate the daemon's original pending snapshot before signing and executing it. A same-user project writer can rewrite mcpPromptDeclaration to match a changed MCP implementation while preserving the reviewed tool name and input. Because the operator review digest omits MCP declaration metadata, the existing receipt remains valid; preflight then validates the attacker-updated declaration against the new server and executes that implementation before the terminal HMAC provides any protection.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/approval-queue.ts
claim:

> Manual approval does not authenticate the daemon's original pending snapshot before signing and executing it. A same-user project writer can rewrite mcpPromptDeclaration to match a changed MCP implementation while preserving the reviewed tool name and input. Because the operator review digest omits MCP declaration metadata, the existing receipt remains valid; preflight then validates the attacker-updated declaration against the new server and executes that implementation before the terminal HMAC provides any protection.

## Desired Outcome

> Verify the daemon-held pending digest before creating any execution snapshot, lease, or approved terminal record, and derive the terminal record from the immutable queue-time snapshot rather than mutable project storage. Treat pending records whose digest is unavailable after restart as non-executable. Bind MCP declaration and transport identity metadata into the operator review receipt as defense in depth, with a regression that rewrites both the MCP configuration and pending declaration before approval.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T04-53-05-308Z-security-review-1x5imx.

finding id: finding-manual-approval-can-launder-rewritten-mcp-declaration
candidate id: auth-approval-boundary:src/core/daemon/approval-queue.ts:1
verdict: confirmed
rationale:

> ApprovalResolutionAuthenticator records a queue-time pending digest, but ApprovalQueue.selectForExecution and selectApprovalForExecution never authenticate it. The approval route therefore builds its execution descriptor from the current mutable record, while createApprovalReviewDescriptor omits mcpPromptDeclaration. A rewritten declaration can retain the prior review digest, pass MCP preflight against correspondingly changed configuration, and then be signed as an approved terminal record by approveSelected.

Evidence:

Evidence 1:

path: src/core/daemon/approval-queue.ts

line: 205

excerpt:

> private selectForExecution(id: string) {
>   return selectApprovalForExecution(
>     this.records,
>     this.executionInputs,
>     this.reviewContexts,
>     this.scopeId,
>     id,
>   );
> }

Evidence 2:

path: src/core/daemon/approval-review-descriptor.ts

line: 151

excerpt:

> const digestPayload = {
>   approval: {
>     id: approval.id,
>     kind: approval.kind,
>     tool: approval.tool,
>     scopeId: approval.scopeId,
>     risk: approval.risk,
>     reason: approval.reason,
>     ...(approval.source !== undefined ? { source: approval.source } : {}),
>     ...(approval.sessionId !== undefined ? { sessionId: approval.sessionId } : {}),
>   },
>   input: projected,
> };

Evidence 3:

path: src/modules/approval-queue/approval-execution-preflight.ts

line: 81

excerpt:

> const parsed = parseToolName(item.tool);
> const declaration = item.mcpPromptDeclaration;
> ...
> const currentFingerprint = mcpManager.getToolDeclarationFingerprint(item.tool);
> if (currentFingerprint !== declaration.promptDeclarationFingerprint) {

Evidence 4:

path: src/core/daemon/approval-queue.ts

line: 269

excerpt:

> if (!pendingApprovalMatchesExecutionDescriptor(
>   approval,
>   executionInput,
>   reviewContext,
>   descriptor,
> )) {
>   return { ok: false, reason: "descriptor_mismatch", approval };
> }
> const approved = this.approveSelected(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/core/daemon/approval-*.test.ts src/core/workflow/steps/approval-step-integrity.test.ts src/modules/approval-queue/*.test.ts --configLoader runner --silent=true` — 52 files passed, 256 tests passed after the source-size repair split the MCP-specific regressions into focused suites.
- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/biome check` passed for all changed approval source and test files.
- `node --conditions=source --import tsx src/validate-queue.ts` passed against the exact workspace-local staged index.
- The exact-index severe source-size check passed with two advisory warnings, below the blocking threshold of four. The linked worktree's host index was read-only, so `.kota/runs/2026-07-31T05-58-15-336Z-builder-sn73u2/evidence/artifacts/host-index-replay.txt` records the prescribed workspace-local index replay and staging validation.
- A full-repository Vitest sweep was also attempted. It reached unrelated environment-dependent failures (including missing prebuilt `dist/` output and sandbox symlink-policy fixtures) and was stopped after long retrying fixtures; the focused approval suite above completed cleanly.
