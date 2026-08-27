---
status: done
---

# Treat progress-review evidence as untrusted input

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts
claim:

> prepare-review-input contains project-controlled task titles and external event payload summaries but is exposed without exposedOutputTrust: "untrusted". The prompt builder consequently emits it as an ordinary step block without injection detection, boundary escaping, or an untrusted-content envelope, allowing hostile channel or task text to influence the autonomous reviewer that proposes durable tasks and owner questions.

## Desired Outcome

> Declare exposedOutputTrust: "untrusted" on prepare-review-input so the shared prompt renderer screens and escapes it. Add focused prompt tests containing hostile task titles, inbound message bodies, closing untrusted-content tags, and markdown fences, asserting that the raw boundary text never appears outside the escaped untrusted envelope and that no resulting agent output can bypass the existing evidence and action gates.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T05-55-19-910Z-security-review-46yls1.

finding id: finding-progress-reviewer-exposed-evidence-trust
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts:1
verdict: confirmed
rationale:

> prepare-review-input exposes task titles and serialized event payload summaries without exposedOutputTrust: "untrusted". The prompt renderer therefore emits ordinary JSON without injection screening, boundary escaping, or an untrusted-content envelope, despite these fields containing project- or externally-controlled text used by an autonomous reviewer that proposes durable actions.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 108

excerpt:

> export const prepareReviewInput = typedCodeStep<ProgressReviewAgentEvidencePacket>({
>   id: "prepare-review-input",
>   type: "code",
>   when: stepSucceeded("collect-evidence"),
>   exposeOutputToAgent: true,
>   validate: validateProgressReviewAgentEvidencePacket,

Evidence 2:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/task-evidence.ts

line: 30

excerpt:

> return {
>   id: sourceEvidenceId(source, `task:${record.id}`),
>   kind: "task",
>   taskId: record.id,
>   title: record.title,
>   state: record.state,

Evidence 3:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/event-evidence.ts

line: 81

excerpt:

> function batchEventEvidence(
>   source: ProgressReviewDirectorySource,
>   input: IndexedBatchEvent,
> ): ProgressReviewEventEvidence {
>   const payloadSummary = summarizePayload(input.event.payload);

Evidence 4:

path: src/core/workflow/steps/step-executor-agent-prompt.ts

line: 136

excerpt:

> function buildExposedStepOutputBlock(
>   id: string,
>   output: ExposedStepOutput,
>   trust: "untrusted" | undefined,
> ): string[] {
>   if (trust !== "untrusted") {
>     return [`<step id="${id}">`, JSON.stringify(output, null, 2), "</step>"];
>   }

Evidence 5:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/actions.ts

line: 27

excerpt:

> for (const { group } of progressReviewFindingGroupEntries(args.review)) {
>   for (const task of group.followUpTasks) {
>     applied.push(writeFollowUpTask({ ...args, task }));
>   }
> }
> for (const question of args.review.ownerQuestions) {
>   applied.push(...enqueueOwnerQuestion({ ...args, question }));
> }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion

`prepare-review-input` now declares untrusted output. The shared prompt renderer
owns screening, escaping, and the untrusted-content envelope; the reviewer
fixture parses that public envelope instead of bypassing it.
