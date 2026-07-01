---
id: task-security-review-autonomy-health-owner-action-quest
title: Security review: Autonomy health owner-action questions still persist and broadcast raw health-signal summaries from runtime-derived evidence. The new projection strips dead-letter/module-log summaries for review artifacts and cards, but the owner-question action path sends the unprojected first group summary into OwnerQuestionQueue.reason, which is emitted on owner.question.asked and forwarded by notification channels.
status: done
priority: p2
area: security
summary: Autonomy health owner-action questions still persist and broadcast raw health-signal summaries from runtime-derived evidence. The new projection strips dead-letter/module-log summaries for review artifacts and cards, but the owner-question action path sends the unprojected first group summary into OwnerQuestionQueue.reason, which is emitted on owner.question.asked and forwarded by notification channels.
created_at: 2026-07-01T08:55:52.218Z
updated_at: 2026-07-01T09:21:53Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts
claim:

> Autonomy health owner-action questions still persist and broadcast raw health-signal summaries from runtime-derived evidence. The new projection strips dead-letter/module-log summaries for review artifacts and cards, but the owner-question action path sends the unprojected first group summary into OwnerQuestionQueue.reason, which is emitted on owner.question.asked and forwarded by notification channels.

## Desired Outcome

> Project owner-question reason/context through the same autonomy health evidence policy before enqueueing or emitting them, or build those fields only from bounded metadata. Add regression coverage for owner-action/external-service health signals with dead-letter or module-log evidence proving the stored owner question and owner.question.asked notification payload omit raw summaries and evidenceRef.summary text.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-01T06-53-37-002Z-security-review-5l4xwb.

finding id: health-review-owner-question-raw-summary
candidate id: secret-handling:src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:520
verdict: confirmed
rationale:

> apply-actions passes the original buildReview output into applyAutonomyHealthReviewActions (src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.ts:152-156). For owner-action/external-service groups, enqueueOwnerQuestion builds OwnerQuestionQueue.reason from args.group.summaries[0] (src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:728-733 and 684-686), while projection of runtime-derived summaries happens only later in writeAutonomyHealthReviewArtifact (src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:812-819). OwnerQuestionQueue stores reason unchanged and emits it on owner.question.asked (src/core/daemon/owner-question-queue.ts:139-160), and email formatting includes that reason verbatim (src/modules/email/format.ts:124-141).

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 728

excerpt:



> if (group.actionability === "owner-action" || group.actionability === "external-service")

Evidence 2:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 684

excerpt:



> reason: `${args.group.summaries[0] ?? "Health signal requires owner action."} ` +

Evidence 3:



path: src/core/daemon/owner-question-queue.ts

line: 140

excerpt:



> context: input.context, question: input.question, reason: input.reason,

Evidence 4:



path: src/core/daemon/owner-question-queue.ts

line: 155

excerpt:



> this.pbus.emit("owner.question.asked", {

Evidence 5:



path: src/modules/email/format.ts

line: 140

excerpt:



> if (reason) lines.push(`Reason: ${reason}`);

Evidence 6:



path: src/modules/autonomy/health-review-evidence-policy.ts

line: 42

excerpt:



> if (hasRuntimeDerivedHealthEvidence(refs)) return RUNTIME_DERIVED_SUMMARY_OMITTED;

Evidence 7:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 818

excerpt:



> const projected = projectAutonomyHealthReviewArtifactForPersistence(artifact);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts` passed on 2026-07-01.
- `pnpm typecheck` passed on 2026-07-01.
- `pnpm exec biome check src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts` passed on 2026-07-01.
