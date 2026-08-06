---
id: task-security-review-the-owner-decision-gate-accepts-ye
title: Security review: The owner-decision gate accepts `yes`, `approve`, `promote`, or `unblock` as approval even when the answer was not offered by the task's proposed_answers. Because the blocked task controls the question, an affirmative answer to a question whose meaning is to remain blocked can be interpreted as authorization to write a resolved marker and promote the task, reversing the operator's intent.
status: done
priority: p2
area: security
task_class: Safety
summary: The owner-decision gate accepts `yes`, `approve`, `promote`, or `unblock` as approval even when the answer was not offered by the task's proposed_answers. Because the blocked task controls the question, an affirmative answer to a question whose meaning is to remain blocked can be interpreted as authorization to write a resolved marker and promote the task, reversing the operator's intent.
created_at: 2026-08-03T17:21:44.136Z
updated_at: 2026-08-06T09:46:31.094Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/blocked-promoter/workflow.ts
claim:

> The owner-decision gate accepts `yes`, `approve`, `promote`, or `unblock` as approval even when the answer was not offered by the task's proposed_answers. Because the blocked task controls the question, an affirmative answer to a question whose meaning is to remain blocked can be interpreted as authorization to write a resolved marker and promote the task, reversing the operator's intent.

## Desired Outcome

> Require the explicit displayed `unblock` token or another typed per-precondition approval token; do not accept global affirmative synonyms outside proposed_answers. Revalidate the current task precondition after the await step and add tests where `yes` or `approve` is absent from the offered answers and has a non-unblocking meaning.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T16-47-03-618Z-security-review-5xx1f0.

finding id: security-review-blocked-promoter-ambiguous-owner-approval
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/blocked-promoter/workflow.ts:197
verdict: confirmed
rationale:

> answerApprovesPromotion unconditionally accepts unblock, promote, approve, and yes before consulting proposedAnswers, contradicting both its conservative contract and the repo-task documentation that names literal unblock as the promotion signal. Owner-decision questions are otherwise unrestricted apart from ending in a question mark, so an affirmative answer to a negatively phrased or differently scoped question can create the resolved marker and promote the task. The outcome application also uses the pre-await candidate without revalidating the current precondition.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/blocked-promoter/workflow.ts

line: 197

excerpt:



> approved = answerApprovesPromotion(outcome.answer, candidate.proposedAnswers);

Evidence 2:



path: src/modules/autonomy/workflows/blocked-promoter/promotion.ts

line: 158

excerpt:



> question: precondition.question, context: precondition.context, proposedAnswers: precondition.proposedAnswers

Evidence 3:



path: src/modules/autonomy/workflows/blocked-promoter/promotion.ts

line: 215

excerpt:



> if (APPROVAL_ANSWERS.has(normalized)) return true;

Evidence 4:



path: src/modules/autonomy/workflows/blocked-promoter/promotion.ts

line: 256

excerpt:



> if (approved) { ... renderOwnerResolvedMarker(...) ... applications.push({ kind: "resolved", ... }); }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification: `TMPDIR="$(cd "${TMPDIR:-/tmp}" && pwd -P)" NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=true src/modules/autonomy/workflows/blocked-promoter/owner-decision-authorization.test.ts src/modules/autonomy/workflows/blocked-promoter/owner-decision-authorization.workflow.test.ts src/modules/autonomy/workflows/blocked-promoter/promotion.test.ts src/modules/autonomy/workflows/blocked-promoter/workflow.test.ts src/modules/autonomy/workflows/blocked-promoter/owner-decision-cycle.integration.test.ts` (44 tests passed), plus `src/cli.test.ts` in the combined 79-test run, `pnpm typecheck`, and focused Biome checks.
