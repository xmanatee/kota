---
id: task-security-review-autonomy-health-review-artifacts-s
title: Security review: Autonomy health review artifacts still persist runtime-derived summaries and evidence-ref summaries from module logs and dead-letter failure reasons. Generated task Markdown now fences that data, but the review artifact stores the raw review object and health issue cards later surface those fields, so prompt-like runtime text can still escape the intended evidence boundary.
status: ready
priority: p2
area: security
summary: Autonomy health review artifacts still persist runtime-derived summaries and evidence-ref summaries from module logs and dead-letter failure reasons. Generated task Markdown now fences that data, but the review artifact stores the raw review object and health issue cards later surface those fields, so prompt-like runtime text can still escape the intended evidence boundary.
created_at: 2026-07-01T07:03:06.305Z
updated_at: 2026-07-01T07:03:06.305Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts
claim:

> Autonomy health review artifacts still persist runtime-derived summaries and evidence-ref summaries from module logs and dead-letter failure reasons. Generated task Markdown now fences that data, but the review artifact stores the raw review object and health issue cards later surface those fields, so prompt-like runtime text can still escape the intended evidence boundary.

## Desired Outcome

> Project autonomy health review artifacts and issue-card data through the evidence policy before persistence or presentation: keep refs/counts/dedupe metadata, and redact, prune, or explicitly bounded-reference runtime summaries and evidenceRef.summary values from module logs and dead letters. Add regression coverage proving prompt-like log or DLQ text is absent from autonomy-health-review.json and health issue cards.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-01T05-40-03-878Z-security-review-xknost.

finding id: health-review-raw-runtime-evidence-artifact
candidate id: secret-handling:src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:515
verdict: confirmed
rationale:

> Runtime module logs set AutonomyHealthEvidenceRef.summary from observation.text (src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-module-logs.ts:62-66), and stale DLQ evidence includes item.failure.reason in evidenceRefs.summary (src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-dead-letters.ts:73-79). buildAutonomyHealthReview carries signal.summary and evidenceRefs into groups (src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:244-259), then writeAutonomyHealthReviewArtifact persists the whole artifact with JSON.stringify (src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:758-764). collectRecentAutonomyHealthIssueCards copies group.summaries and group.evidenceRefs into issue cards (src/modules/autonomy/health-issue-cards.ts:132-141), and improver exposes those cards to an agent (src/modules/autonomy/workflows/improver/workflow.ts:90-103). That conflicts with src/modules/autonomy/workflows/autonomy-health-reviewer/AGENTS.md:7-8.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 45

excerpt:



> summaries: string[];

Evidence 2:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 46

excerpt:



> evidenceRefs: AutonomyHealthEvidenceRef[];

Evidence 3:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 764

excerpt:



> writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

Evidence 4:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-module-logs.ts

line: 65

excerpt:



> summary: truncateSingleLine(observation.text),

Evidence 5:



path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-dead-letters.ts

line: 78

excerpt:



> `${item.id}: ${item.failure.lastErrorClass} ${item.failure.reason}`,

Evidence 6:



path: src/modules/autonomy/health-issue-cards.ts

line: 138

excerpt:



> summaries: stringArray(args.group.summaries).slice(0, MAX_SUMMARIES_PER_CARD),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
