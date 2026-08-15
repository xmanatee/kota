---
id: task-security-review-the-progress-reviewers-citation-ga
title: Security review: The progress-reviewer's citation gate and action step trust progress-review-evidence.json after the review agent has been granted permission to modify that artifact. A compromised or injected agent can add a fabricated evidence ID, cite it in its final output, and have both output validation and apply-actions accept the modified evidence before materializing an ungrounded task or owner question.
status: ready
priority: p1
area: security
task_class: Safety
summary: The progress-reviewer's citation gate and action step trust progress-review-evidence.json after the review agent has been granted permission to modify that artifact. A compromised or injected agent can add a fabricated evidence ID, cite it in its final output, and have both output validation and apply-actions accept the modified evidence before materializing an ungrounded task or owner question.
created_at: 2026-08-15T08:13:58.075Z
updated_at: 2026-08-15T08:13:58.075Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts
claim:

> The progress-reviewer's citation gate and action step trust progress-review-evidence.json after the review agent has been granted permission to modify that artifact. A compromised or injected agent can add a fabricated evidence ID, cite it in its final output, and have both output validation and apply-actions accept the modified evidence before materializing an ungrounded task or owner question.

## Desired Outcome

> Keep runtime-authored evidence immutable across the agent step. Validate and apply the response against a trusted in-memory snapshot or a digest-bound artifact, and narrow agent writes to a dedicated output directory that excludes evidence, step state, and metadata. Add a runtime test whose fake harness rewrites progress-review-evidence.json and returns a citation that exists only in the forged copy; validation must reject it and create no task or owner question.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T05-55-19-910Z-security-review-46yls1.

finding id: finding-progress-reviewer-agent-mutable-evidence
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/workflow.ts:1
verdict: confirmed
rationale:

> The reviewer has write access to .kota/runs/, which includes progress-review-evidence.json. Output validation re-reads that file through readProgressReviewEvidencePacketFromHandle, and apply-actions re-reads it again before materializing tasks or owner questions. No immutable snapshot or digest binds the runtime-authored evidence, so an agent-written evidence ID can become authoritative.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 47

excerpt:



> export const agent: AgentDef = {
>   name: "progress-reviewer",
>   role: "Assess bounded scoped activity evidence and return structured steering recommendations.",
>   promptPath: "src/modules/autonomy/workflows/progress-reviewer/prompt.md",
>   ...AUTONOMY_AGENT_DEFAULTS,
>   writeScope: [".kota/runs/"],
> };

Evidence 2:



path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 59

excerpt:



> function writeProgressReviewEvidencePacket(
>   runDirPath: string,
>   packet: ProgressReviewEvidencePacket,
> ): ProgressReviewEvidenceHandle {
>   const artifactPath = join(runDirPath, PROGRESS_REVIEW_EVIDENCE_ARTIFACT);
>   writeJsonFileAtomic(artifactPath, packet);

Evidence 3:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/agent-step-output.ts

line: 92

excerpt:



> export function validateProgressReviewAgentStepOutput(
>   raw: Parameters<typeof decodeProgressReviewAgentOutputForEvidence>[0],
>   context: WorkflowAgentStepOutputValidationContext,
> ): ProgressReviewAgentOutput {
>   const evidence = readProgressReviewEvidencePacketFromHandle(
>     validateProgressReviewEvidenceHandle(
>       context.stepOutputs["collect-evidence"],
>     ),
>   );

Evidence 4:



path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 132

excerpt:



> run: (ctx) => {
>   const evidence = readProgressReviewEvidencePacket(ctx);
>   return applyProgressReviewActions({
>     projectDir: ctx.projectDir,
>     runId: ctx.workflow.runId,
>     evidence,
>     review: decodeProgressReviewAgentOutputForEvidence(

Evidence 5:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 130

excerpt:



> const result = materializeGeneratedWorkProposal({
>   projectDir: args.projectDir,
>   proposal: {
>     kind: "task",
>     proposalKey,
>     title: task.title,
>     summary: task.summary,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
