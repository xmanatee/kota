---
status: done
---

# Security review: Autonomy health review task generation copies runtime evidence summaries derived from module logs and dead-letter failure reasons directly into ready-task Markdown. Those task files are later treated as builder work contracts, so prompt-like text from runtime logs or failure reasons can be reintroduced as trusted agent instructions instead of isolated evidence.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts
claim:

> Autonomy health review task generation copies runtime evidence summaries derived from module logs and dead-letter failure reasons directly into ready-task Markdown. Those task files are later treated as builder work contracts, so prompt-like text from runtime logs or failure reasons can be reintroduced as trusted agent instructions instead of isolated evidence.

## Desired Outcome

> Render generated health evidence as explicitly untrusted data, with escaped/fenced boundaries or reference-only summaries, before writing it into task files that builder agents will consume.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-01T00-07-01-407Z-security-review-izic0e.

finding id: health-review-untrusted-evidence-task-prompt
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts:8
verdict: confirmed
rationale:

> health-review.ts renders group summaries and evidence refs directly into generated task Markdown, including ref.summary via formatEvidenceRefs at lines 426-428 and task-body interpolation at lines 459-467. Those ref summaries are populated from module log text and dead-letter failure reasons in runtime-health-audit-module-logs.ts lines 62-65 and runtime-health-audit-dead-letters.ts lines 73-79; truncateSingleLine only redacts/separates whitespace, not Markdown/control text. createOrRefreshTask writes the serialized body to data/tasks at health-review.ts lines 600-603, and the builder prompt treats the claimed task as the work contract. An existing generated task shows dead-letter failure text rendered as a normal Source / Intent bullet in data/tasks/archive/task-health-dead-letter-execution-workflow-runtime-progress-reviewer.md lines 25-33.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 461

excerpt:

> ...group.summaries.map((summary) => `- ${summary}`),

Evidence 2:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts

line: 428

excerpt:

> .map((ref) => `- ${ref.kind}: ${ref.ref}${ref.summary ? ` - ${ref.summary}` : ""}`)

Evidence 3:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-dead-letters.ts

line: 78

excerpt:

> `${item.id}: ${item.failure.lastErrorClass} ${item.failure.reason}`,

Evidence 4:

path: src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-module-logs.ts

line: 65

excerpt:

> summary: truncateSingleLine(observation.text),

Evidence 5:

path: src/modules/autonomy/workflows/builder/prompt.md

line: 18

excerpt:

> - Treat the task as a contract, not a script. Own the technical plan yourself.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Result

Health-review generated tasks now render runtime-derived summaries and evidence refs as explicitly untrusted fenced JSON rather than trusted Markdown bullets. The renderer chooses a fence longer than any embedded backtick run, so prompt-like text and code fences from module logs or dead-letter reasons cannot break out into task-contract sections.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verified with `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts`.
- Verified with `pnpm typecheck`.
- Verified with `pnpm lint`.
- Verified with `pnpm build`.
- Verified with `pnpm kota workflow validate`.
- Verified with `pnpm run validate-tasks` after staging the changed paths.
