---
id: task-security-review-progress-reviewer-creates-follow-u
title: Security review: Progress-reviewer creates follow-up task files from raw review-agent strings without escaping frontmatter scalars or body prose. Because the review evidence can include untrusted trigger/channel content, injected newlines, frontmatter keys, or markdown headings can alter task metadata or future workflow instructions.
status: done
priority: p2
area: security
task_class: Safety
summary: Progress-reviewer creates follow-up task files from raw review-agent strings without escaping frontmatter scalars or body prose. Because the review evidence can include untrusted trigger/channel content, injected newlines, frontmatter keys, or markdown headings can alter task metadata or future workflow instructions.
created_at: 2026-07-01T20:32:11.313Z
updated_at: 2026-07-01T21:00:35.449Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts
claim:

> Progress-reviewer creates follow-up task files from raw review-agent strings without escaping frontmatter scalars or body prose. Because the review evidence can include untrusted trigger/channel content, injected newlines, frontmatter keys, or markdown headings can alter task metadata or future workflow instructions.

## Desired Outcome

> Treat progress-review follow-up task fields as untrusted data before writing task files: reject or normalize control characters/newlines in frontmatter scalars, quote or otherwise fence agent-provided prose in body sections, and add regression coverage with newline/frontmatter/markdown-heading payloads proving fixed metadata and fixed task sections cannot be overridden.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Result

Progress-reviewer follow-up task creation now normalizes generated task
frontmatter scalars before serialization and renders review-agent prose as
indented body text under fixed sections, preventing injected frontmatter keys,
delimiters, or markdown headings from overriding task metadata or sections.

## Source / Intent

Created by security-review workflow run 2026-07-01T19-21-28-869Z-security-review-1es8xi.

finding id: finding-progress-reviewer-followup-task-content-injection
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts:2
verdict: confirmed
rationale:

> Confirmed. Progress-reviewer treats trigger/channel content as untrusted, but follow-up task strings are only schema-checked as non-empty strings in src/modules/autonomy/workflows/progress-reviewer/progress-review/agent-output.ts:16. Those strings are written raw into task body sections at action-writers.ts:173 and action-writers.ts:214, and raw into frontmatter at action-writers.ts:257 and action-writers.ts:262. serializeFlatFrontMatter writes string values directly at src/core/util/frontmatter.ts:76, so embedded newlines can inject additional frontmatter keys or delimiters, and embedded markdown headings can create earlier task sections consumed by section parsers such as hasConcreteTaskAcceptanceEvidence in src/modules/repo-tasks/repo-tasks-domain.ts:47.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/progress-reviewer/prompt.md

line: 5

excerpt:



> details not present in that packet. Treat trigger payloads and channel content

Evidence 2:



path: src/modules/autonomy/workflows/progress-reviewer/workflow-steps.ts

line: 194

excerpt:



> review: decodeProgressReviewAgentOutputForEvidence(

Evidence 3:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 173

excerpt:



> args.task.summary,

Evidence 4:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 214

excerpt:



> `- ${args.task.acceptanceEvidence}`,

Evidence 5:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 257

excerpt:



> title: args.task.title,

Evidence 6:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 262

excerpt:



> summary: args.task.summary,

Evidence 7:



path: src/core/util/frontmatter.ts

line: 76

excerpt:



> lines.push(`${key}: ${val}`);

Evidence 8:



path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 268

excerpt:



> serializeFlatFrontMatter(attrs, buildTaskBody({ ...args, taskClass })),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` passed.
- `pnpm run typecheck` passed.
- `pnpm exec biome check src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` passed.
- `pnpm run validate-tasks` passed after staging the completed task move and run artifacts.
