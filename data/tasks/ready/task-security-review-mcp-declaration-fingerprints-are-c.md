---
id: task-security-review-mcp-declaration-fingerprints-are-c
title: Security review: MCP declaration fingerprints are checked during preflight, but execution does not atomically bind dispatch to the checked manager entry. The leased manager can process a tool-list refresh after preflight; executeTool then resolves the tool again from the mutable current map and can dispatch an entry whose declaration differs from the one approved.
status: ready
priority: p2
area: security
task_class: Safety
summary: MCP declaration fingerprints are checked during preflight, but execution does not atomically bind dispatch to the checked manager entry. The leased manager can process a tool-list refresh after preflight; executeTool then resolves the tool again from the mutable current map and can dispatch an entry whose declaration differs from the one approved.
created_at: 2026-07-28T22:09:25.966Z
updated_at: 2026-07-28T22:09:25.966Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/approval-execution.ts
claim:

> MCP declaration fingerprints are checked during preflight, but execution does not atomically bind dispatch to the checked manager entry. The leased manager can process a tool-list refresh after preflight; executeTool then resolves the tool again from the mutable current map and can dispatch an entry whose declaration differs from the one approved.

## Desired Outcome

> Add a manager execution primitive that synchronously selects the exact entry, verifies its declaration fingerprint against the lease, and dispatches through that captured entry. Do not re-resolve the tool from the mutable registry after validation; reject if a refresh changed or removed the approved declaration.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T21-49-54-397Z-security-review-declvj.

finding id: finding-mcp-declaration-can-drift-after-preflight
candidate id: mcp-transport:src/modules/approval-queue/approval-execution.ts:12
verdict: confirmed
rationale:

> MCP preflight checks the current declaration fingerprint and stores only the mutable McpManager in the execution lease. That manager subscribes to tools/list_changed and asynchronously replaces toolMap entries. The later executeApprovedTool call invokes McpManager.executeTool, which resolves the entry from the current toolMap without comparing its fingerprint to the lease. A refresh between preflight and dispatch can therefore replace the validated declaration before execution.

Evidence:

Evidence 1:



path: src/modules/approval-queue/approval-execution.ts

line: 184

excerpt:



> const currentFingerprint = mcpManager.getToolDeclarationFingerprint(item.tool);
> if (currentFingerprint !== declaration.promptDeclarationFingerprint) {

Evidence 2:



path: src/modules/approval-queue/approval-execution.ts

line: 252

excerpt:



> return {
>   ok: true,
>   lease: { ...snapshot.descriptor, mcpManager },
> };

Evidence 3:



path: src/modules/approval-queue/approval-execution.ts

line: 297

excerpt:



> lease === undefined
> || !approvedApprovalMatchesExecutionDescriptor(item, lease)
> || (isMcpManagedToolName(item.tool) && lease.mcpManager === undefined)

Evidence 4:



path: src/modules/approval-queue/approval-execution.ts

line: 319

excerpt:



> const result = await mcpManager.executeTool(item.tool, item.input);

Evidence 5:



path: src/core/mcp/manager.ts

line: 753

excerpt:



> const entry = this.toolMap.get(name);

Evidence 6:



path: src/core/mcp/manager.ts

line: 1939

excerpt:



> private queueServerToolRefresh(serverName: string): void {
>   ...
>   const next = previous
>     .catch(() => {})
>     .then(() => this.refreshServerTools(serverName))

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
