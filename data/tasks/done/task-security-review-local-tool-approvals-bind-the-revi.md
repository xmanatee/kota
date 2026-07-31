---
id: task-security-review-local-tool-approvals-bind-the-revi
title: Security review: Local tool approvals bind the reviewed tool name and input but not the registered declaration, effect metadata, runner, or registry generation. Runtime custom tools can be replaced under the same name after an approval is queued; non-MCP preflight accepts the name-only descriptor and execution then resolves the current runner, allowing different code to execute under the stale approval.
status: done
priority: p2
area: security
task_class: Safety
summary: Local tool approvals bind the reviewed tool name and input but not the registered declaration, effect metadata, runner, or registry generation. Runtime custom tools can be replaced under the same name after an approval is queued; non-MCP preflight accepts the name-only descriptor and execution then resolves the current runner, allowing different code to execute under the stale approval.
created_at: 2026-07-31T03:07:45.474Z
updated_at: 2026-07-31T05:18:46.645Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/approval-execution-descriptor.ts
claim:

> Local tool approvals bind the reviewed tool name and input but not the registered declaration, effect metadata, runner, or registry generation. Runtime custom tools can be replaced under the same name after an approval is queued; non-MCP preflight accepts the name-only descriptor and execution then resolves the current runner, allowing different code to execute under the stale approval.

## Desired Outcome

> Capture a local registration generation and declaration/effect fingerprint when the original call is queued, include them in the review and execution descriptors, and reject approval when the registration has changed. Preflight should lease the exact validated tool definition and runner, and execution should dispatch through that captured lease rather than resolving the mutable registry by name.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T00-35-34-068Z-security-review-2pibca.

finding id: finding-local-tool-approval-not-bound-to-registry-generation
candidate id: auth-approval-boundary:src/core/daemon/approval-execution-descriptor.ts:1
verdict: confirmed
rationale:

> Local-tool descriptors and leases contain no registry generation, declaration/effect fingerprint, or captured runner. Non-MCP preflight copies the name-based descriptor, and execution resolves that name from the mutable registry. A runtime probe queued approval under one registration, replaced it under the same name, and executed the replacement runner successfully.

Evidence:

Evidence 1:



path: src/core/daemon/approval-execution-descriptor.ts

line: 9

excerpt:



> export type ApprovalExecutionDescriptor = {
>  approvalId: string;
>  kind: ApprovalKind;
>  tool: string;
>  scopeId: string;
>  sessionId?: string;
>  inputDigest: string;
>  reviewDigest: string;
>  approvalSnapshotDigest: string;
>  mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
> };

Evidence 2:



path: src/modules/approval-queue/approval-execution-preflight.ts

line: 76

excerpt:



> const item = snapshot.approval;
> if (!isMcpManagedToolName(item.tool)) {
>  return { ok: true, lease: { ...snapshot.descriptor } };
> }

Evidence 3:



path: src/modules/approval-queue/approval-execution.ts

line: 115

excerpt:



> const result = executionContext
>  ? await executeTool(item.tool, item.input, executionContext)
>  : await executeTool(item.tool, item.input);

Evidence 4:



path: src/core/tools/index.ts

line: 141

excerpt:



> const runner = runners[name];
> if (!runner) {
>   return { content: `Unknown tool: ${name}`, is_error: true };
> }
> try {
>   const result = await runner(input, context);

Evidence 5:



path: src/core/tools/custom-tool-handlers.ts

line: 60

excerpt:



> if (customDefs.has(name)) {
>   deregister(name);
>   customDefs.delete(name);
> }
>
> const def: CustomToolDef = { name, description, parameters, code, language };
> ...
> register(toolDef, buildRunner(def));

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

Local approvals now carry the registered tool generation and combined
declaration/effect fingerprint in both review and execution descriptors.
Preflight rejects missing or changed registrations, revalidates the original
input against the leased definition, and captures the exact runner used by
execution. Regression coverage proves a same-name replacement cannot consume a
stale approval and a post-preflight replacement cannot redirect the leased
call.

Final verification:
`TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --exclude src/modules/repo-tasks/task-queue-validation.test.ts --configLoader runner --silent=true`
(1,170 files and 12,280 tests passed; the excluded index-coupled queue gate
passed through `node --import tsx src/validate-queue.ts` against the isolated
staged index).
