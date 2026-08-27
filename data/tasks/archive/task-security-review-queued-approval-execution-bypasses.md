---
status: done
---

# Security review: Queued approval execution bypasses the MCP manager and prompt-time declaration fingerprint check. A supervised MCP tool call queued while fresh can later be approved through the approval route and executed with executeTool by name only; if a local, manifest, or foreign module runner with the same mcp__... name is present, approval can execute that runner under the stale MCP approval context.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/routes.ts
claim:

> Queued approval execution bypasses the MCP manager and prompt-time declaration fingerprint check. A supervised MCP tool call queued while fresh can later be approved through the approval route and executed with executeTool by name only; if a local, manifest, or foreign module runner with the same mcp__... name is present, approval can execute that runner under the stale MCP approval context.

## Desired Outcome

> Persist the prompt-visible MCP declaration fingerprint/source on queued approvals and route approved MCP-prefixed items back through executeToolCalls or an MCP-aware approval executor that rechecks the current fingerprint before execution. Also reserve the mcp__ prefix for MCP-managed tools in local, manifest, custom, and foreign tool registration.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-23T12-22-24-335Z-security-review-0x5cmx.

finding id: stale-mcp-approval-route-bypass
candidate id: mcp-transport:src/core/tools/tool-runner.ts:426
verdict: confirmed
rationale:

> Current code still queues supervised tool calls with only tool/input metadata and no MCP declaration fingerprint, then approval routes execute approved items through executeTool(item.tool, item.input, executionContext) in src/modules/approval-queue/routes.ts:178-185. That bypasses executeToolCalls' MCP manager path and stale declaration checks at src/core/tools/tool-runner.ts:241-246 and src/core/tools/tool-runner.ts:453-471, while the project runtime exposed to approval routes excludes an MCP manager in src/core/daemon/project-scope-provider.ts:9-12. Local/custom/manifest tool name validation also does not reserve the mcp__ namespace: src/core/tools/custom-tool-persistence.ts:14-30 and src/core/manifest/validation.ts:48,115-120 accept names matching that pattern unless they collide with reserved local tool names.

Evidence:

Evidence 1:

path: src/core/loop/loop-send.ts

line: 127

excerpt:

> const mcpTools = state.mcpManager ? state.mcpManager.getTools() : [];

Evidence 2:

path: src/core/loop/loop-send.ts

line: 232

excerpt:

> ...(mcpPromptToolDeclarationFingerprints ? { mcpPromptToolDeclarationFingerprints } : {}),

Evidence 3:

path: src/core/tools/tool-runner.ts

line: 241

excerpt:

> const staleMcpResult = staleMcpDeclarationResult(block.name, mcpManager, mcpPromptToolDeclarationFingerprints);

Evidence 4:

path: src/core/tools/tool-runner.ts

line: 453

excerpt:

> const baseFn = async () => { const dispatchStaleMcpResult = staleMcpDeclarationResult(call.name, mcpManager, mcpPromptToolDeclarationFingerprints);

Evidence 5:

path: src/modules/approval-queue/routes.ts

line: 183

excerpt:

> const result = executionContext ? await executeTool(item.tool, item.input, executionContext) : await executeTool(item.tool, item.input);

Evidence 6:

path: src/core/tools/custom-tool-persistence.ts

line: 14

excerpt:

> export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;

Evidence 7:

path: src/core/manifest/validation.ts

line: 115

excerpt:

> } else if (!TOOL_NAME_RE.test(t.name as string)) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Implemented code-level fix: supervised/queued MCP approvals now persist the prompt declaration server, tool, and fingerprint; approval execution rejects MCP-prefixed approvals without matching current MCP declaration metadata before queue mutation; fresh MCP approvals execute through an MCP manager instead of `executeTool` by name; `mcp__` is rejected for custom, manifest, module-registered, and foreign tools.
- Focused regression coverage: `src/modules/approval-queue/routes-mcp-execution.test.ts` covers missing MCP metadata, stale declaration rejection, fresh MCP manager execution, and daemon-control preflight-before-mutation; `src/core/daemon/approval-queue-mcp.test.ts` and `src/core/tools/tool-runner-mcp-approval.test.ts` cover stored metadata; custom/manifest/module/foreign tests cover namespace reservation.
- Verification passed: `pnpm test src/modules/approval-queue/routes.test.ts src/modules/approval-queue/routes-mcp-execution.test.ts src/core/daemon/approval-queue.test.ts src/core/daemon/approval-queue-mcp.test.ts src/core/tools/tool-runner.test.ts src/core/tools/tool-runner-mcp-approval.test.ts src/core/tools/custom-tool.test.ts src/core/tools/custom-tool-name-policy.test.ts src/core/tools/index.test.ts src/core/tools/register-tool-name-policy.test.ts src/core/manifest/module-factory.test.ts src/core/manifest/tool-name-policy.test.ts src/core/modules/foreign-module-loader.test.ts` (263 tests), `pnpm typecheck`, `pnpm lint`, `pnpm validate-tasks`, and the staged severe source-size evaluator (`Advisory source-size warning(s): src/core/daemon/approval-queue.ts, src/core/modules/foreign-module-loader.ts, src/modules/approval-queue/routes.ts.`).
