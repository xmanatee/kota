---
id: task-security-review-the-approval-surface-hides-the-com
title: Security review: The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.
status: ready
priority: p1
area: security
task_class: Safety
summary: The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.
created_at: 2026-07-28T22:09:25.940Z
updated_at: 2026-07-28T22:09:25.940Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/approval-queue.ts
claim:

> The approval surface hides the complete tool input and conversation context from the operator, including non-secret fields such as shell commands, paths, and arguments. Supervised-mode approvals therefore authorize and execute a specific raw input that the operator cannot inspect, reducing the human approval boundary to trusting the tool name, risk label, and a generic reason.

## Desired Outcome

> Expose a trusted, operator-safe review descriptor derived from each tool's validated input, preserving security-relevant commands, paths, operations, and arguments while selectively redacting credential fields. Bind that displayed descriptor or its digest to the execution lease so approval demonstrably covers the exact reviewed operation.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T21-49-54-397Z-security-review-declvj.

finding id: finding-approval-operator-cannot-review-tool-input
candidate id: auth-approval-boundary:src/core/daemon/approval-queue.ts:1
verdict: confirmed
rationale:

> ApprovalQueue retains executable input only in its private in-memory map, while projectApprovalForStorage replaces the entire input and context with tool-I/O redaction records. Every operator route uses projectApprovalForClient, whose daemon-api projection also omits all tool I/O, and the CLI consequently renders only the redaction marker. The supervised-mode reason is generic, so the operator cannot inspect the command, paths, arguments, or conversation context before authorizing execution.

Evidence:

Evidence 1:



path: src/core/daemon/approval-queue.ts

line: 192

excerpt:



> this.executionInputs.set(item.id, cloneEvidenceJsonObject(input));
> const stored = this.write(item);

Evidence 2:



path: src/core/daemon/approval-queue-projection.ts

line: 55

excerpt:



> const projected: PendingApproval = {
>   ...projectApprovalTextFields(item),
>   input: projectApprovalInputForStorage(item.input),
> };

Evidence 3:



path: src/core/daemon/approval-queue-projection.ts

line: 67

excerpt:



> const projected = projectApprovalInputForTarget(input, "internal-storage");
> if (!isToolIoRedactionRecord(projected)) {
>   throw new Error("Approval input storage projection must redact tool I/O");
> }

Evidence 4:



path: src/core/daemon/approval-queue-projection.ts

line: 21

excerpt:



> export function projectApprovalForClient(...) {
>   const projected: ApprovalClientProjection = {
>     ...projectApprovalTextFields(item),
>     input: projectApprovalInputForTarget(item.input, target),
>   };

Evidence 5:



path: src/core/tools/autonomy-mode.ts

line: 57

excerpt:



> return {
>   action: "queue",
>   reason: `autonomy mode "supervised" gates ${assessment.risk} tool calls through human approval`,
> };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
