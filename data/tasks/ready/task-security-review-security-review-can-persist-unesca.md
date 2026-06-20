---
id: task-security-review-security-review-can-persist-unesca
title: Security review: Security-review can persist unescaped agent-generated finding strings into normal task frontmatter and markdown, allowing newline/frontmatter or markdown-heading injection to alter task metadata or the builder's Done When criteria.
status: ready
priority: p2
area: security
summary: Security-review can persist unescaped agent-generated finding strings into normal task frontmatter and markdown, allowing newline/frontmatter or markdown-heading injection to alter task metadata or the builder's Done When criteria.
created_at: 2026-06-20T00:55:20.627Z
updated_at: 2026-06-20T00:55:20.627Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/security-review/security-review.ts
claim: Security-review can persist unescaped agent-generated finding strings into normal task frontmatter and markdown, allowing newline/frontmatter or markdown-heading injection to alter task metadata or the builder's Done When criteria.

## Desired Outcome

Before creating tasks, treat investigation and revalidation strings as untrusted content: reject or normalize control newlines in frontmatter fields, render agent-derived markdown as quoted or fenced evidence, prevent generated body fields from introducing task section headings, and add regression coverage for frontmatter override and injected Done When cases.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-20T00-43-07-159Z-security-review-7g40mk.

finding id: security-review-task-content-injection
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/security-review/security-review.ts:876
verdict: confirmed
rationale: Confirmed. Investigation strings are only validated as non-empty strings, merged unchanged into revalidated findings, then written directly into task frontmatter and markdown. `createOrUpdateSecurityFindingTasks` puts `finding.claim` in `title` and `summary`, and `serializeFlatFrontMatter` writes scalar values as raw `key: value` lines without newline escaping. The task body also interpolates `finding.claim`, `finding.recommendedOutcome`, evidence excerpts, and rationale into markdown sections without neutralizing headings, so injected `## Done When` text can precede the generated Done When section and affect builder parsing.

Evidence:

- src/modules/autonomy/workflows/security-review/security-review.ts:283 - claim: z.string().min(1),
- src/modules/autonomy/workflows/security-review/security-review.ts:287 - recommendedOutcome: z.string().min(1),
- src/modules/autonomy/workflows/security-review/security-review.ts:370 - ...expected,
- src/modules/autonomy/workflows/security-review/security-review.ts:778 - `claim: ${finding.claim}`,
- src/modules/autonomy/workflows/security-review/security-review.ts:782 - finding.recommendedOutcome,
- src/modules/autonomy/workflows/security-review/security-review.ts:872 - summary: finding.claim,
- src/modules/autonomy/workflows/security-review/security-review.ts:878 - serializeFlatFrontMatter(attrs, buildFindingTaskBody({ runId: args.runId, finding })),
- src/core/util/frontmatter.ts:55 - lines.push(`${key}: ${val}`);
- src/modules/autonomy/workflows/builder/repair-checks.ts:24 - const doneWhenMatch = taskContent.match(/## Done When\n([\s\S]*?)(?=\n## |\n---|\s*$)/);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
