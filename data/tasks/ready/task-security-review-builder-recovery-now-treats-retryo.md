---
id: task-security-review-builder-recovery-now-treats-retryo
title: Security review: Builder recovery now treats retryOf links read from ordinary .kota/runs metadata as authorization to bypass the exact sourceRunId ownership check. Security-review agents can write that entire directory, while the lineage reader verifies only id and workflow fields. A compromised agent can forge a link to the current claim owner so that an unrelated stale redrive transfers the preserved builder claim and resumes autonomous mutation of its worktree.
status: ready
priority: p2
area: security
task_class: Safety
summary: Builder recovery now treats retryOf links read from ordinary .kota/runs metadata as authorization to bypass the exact sourceRunId ownership check. Security-review agents can write that entire directory, while the lineage reader verifies only id and workflow fields. A compromised agent can forge a link to the current claim owner so that an unrelated stale redrive transfers the preserved builder claim and resumes autonomous mutation of its worktree.
created_at: 2026-08-23T08:53:17.291Z
updated_at: 2026-08-23T08:53:17.291Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/builder/recovery-continuation.ts
claim:

> Builder recovery now treats retryOf links read from ordinary .kota/runs metadata as authorization to bypass the exact sourceRunId ownership check. Security-review agents can write that entire directory, while the lineage reader verifies only id and workflow fields. A compromised agent can forge a link to the current claim owner so that an unrelated stale redrive transfers the preserved builder claim and resumes autonomous mutation of its worktree.

## Desired Outcome

> Authenticate retry ancestry through a daemon-owned append-only record, signature, or other provenance outside every agent write scope; do not use mutually consistent run JSON as proof of ownership. Verify every lineage edge, impose a small maximum depth, and consolidate this remediation with the existing task addressing authenticity of agent-writable run bundles.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T08-38-48-590Z-security-review-wwxpdn.

finding id: security-review-forgeable-builder-retry-lineage
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/builder/recovery-continuation.ts:251
verdict: confirmed
rationale:

> A sourceRunId mismatch is now accepted when retryLineageContainsClaimOwner reaches the current claim owner through .kota/runs/<id>/metadata.json. Each edge is checked only for a path-safe ID, matching metadata ID, builder workflow name, and string retryOf; no daemon-owned provenance authenticates it. Security-review agents are granted the whole .kota/runs/ tree as their machine-enforced write scope, so such metadata can be replaced. A later matching stale recovery retry can therefore pass candidate selection and transfer the preserved claim through continueTaskClaim. Exact task, worktree, workspace, and stale-claim checks limit the impact, but do not repair the authorization boundary. Remediation should be consolidated with the existing run-bundle authenticity task.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/security-review/workflow.ts

line: 46

excerpt:



> export const agent: AgentDef = {
>   name: "security-reviewer",
>   role: "Investigate bounded security-sensitive code candidates and revalidate findings.",
>   promptPath: "src/modules/autonomy/workflows/security-review/prompt.md",
>   ...AUTONOMY_AGENT_DEFAULTS,
>   writeScope: [".kota/runs/"],
> };

Evidence 2:



path: src/modules/autonomy/workflows/builder/recovery-continuation.ts

line: 167

excerpt:



> const retryOf = ctx.trigger.payload.retryOf;
> return listRecoveryClaims(ctx.projectDir).filter((candidate) =>
>   candidate.claim.taskId === taskId &&
>   candidate.claim.worktreeRunId === worktreeRunId &&
>   preservedBuilderWorkspaceDir(candidate) === workspaceDir &&
>   (
>     candidate.claim.runId === sourceRunId ||
>     retryLineageContainsClaimOwner(

Evidence 3:



path: src/modules/autonomy/workflows/builder/recovery-continuation.ts

line: 199

excerpt:



> const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
>   join(projectDir, ".kota", "runs", currentRunId, "metadata.json"),
> );
> if (metadata === null) {
>   throw new Error(
>     `Builder recovery retry lineage run ${currentRunId} is unavailable`,
>   );
> }
> if (metadata.id !== currentRunId || metadata.workflow !== "builder") {

Evidence 4:



path: src/modules/autonomy/workflows/builder/recovery-continuation.ts

line: 247

excerpt:



> return continueTaskClaim({
>   projectDir: ctx.projectDir,
>   taskId: candidate.claim.taskId,
>   sourceRunId: candidate.claim.runId,
>   runId: ctx.workflow.runId,
>   workflowId: "builder",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
