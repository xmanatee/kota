---
id: task-security-review-fixture-candidate-task-creation-co
title: Security review: Fixture-candidate task creation copies the run metadata id into task frontmatter through a serializer that does not quote embedded newlines, so a crafted local run artifact can inject or override task frontmatter fields when --create-task writes a backlog task.
status: ready
priority: p2
area: security
task_class: Safety
summary: Fixture-candidate task creation copies the run metadata id into task frontmatter through a serializer that does not quote embedded newlines, so a crafted local run artifact can inject or override task frontmatter fields when --create-task writes a backlog task.
created_at: 2026-07-07T11:45:55.089Z
updated_at: 2026-07-07T11:45:55.089Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/eval-harness/fixture-candidates-task-writer.ts
claim:

> Fixture-candidate task creation copies the run metadata id into task frontmatter through a serializer that does not quote embedded newlines, so a crafted local run artifact can inject or override task frontmatter fields when --create-task writes a backlog task.

## Desired Outcome

> Reject or normalize fixture-candidate run ids and other frontmatter-bound fields before task creation, and make serializeFlatFrontMatterScalar quote values containing CR/LF/NUL. Add a regression test where metadata.id contains a newline plus a frontmatter key such as priority: p0 and prove the generated task preserves it as summary text rather than a parsed field.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-07T10-30-41-030Z-security-review-i8mawx.

finding id: security-review-fixture-candidate-frontmatter-injection
candidate id: task-workflow-mutation:src/modules/eval-harness/fixture-candidates-task-writer.ts:1
verdict: confirmed
rationale:

> Confirmed. `parseMetadata` accepts `metadata.json` `raw.id` as any string at src/modules/eval-harness/fixture-candidates-artifacts.ts:43, and `createCandidateTask` interpolates `candidate.runId` into frontmatter-bound `title` and `summary` before calling `serializeFlatFrontMatter` at src/modules/eval-harness/fixture-candidates-task-writer.ts:26 and src/modules/eval-harness/fixture-candidates-task-writer.ts:39. The serializer emits scalar values as `key: value` lines at src/core/util/frontmatter.ts:89 and only quotes trim-sensitive, bracket-like, or already quoted strings at src/core/util/frontmatter.ts:102, so embedded CR/LF values remain raw. `parseFlatFrontMatter` then splits frontmatter on newlines and assigns each parsed key at src/core/util/frontmatter.ts:25 and src/core/util/frontmatter.ts:42, allowing a crafted run id in the later `summary` field to inject or override fields such as `priority`.

Evidence:

Evidence 1:



path: src/modules/eval-harness/fixture-candidates-artifacts.ts

line: 43

excerpt:



> const id = parseString(raw.id);

Evidence 2:



path: src/modules/eval-harness/fixture-candidates-task-writer.ts

line: 35

excerpt:



> `Build a compact eval-harness fixture from ${candidate.runId} covering ${candidate.failurePattern.kind}.`,

Evidence 3:



path: src/modules/eval-harness/fixture-candidates-task-writer.ts

line: 39

excerpt:



> writeFileSync(taskPath, serializeFlatFrontMatter(attrs, candidateTaskBody(candidate)));

Evidence 4:



path: src/core/util/frontmatter.ts

line: 97

excerpt:



> function serializeFlatFrontMatterScalar(value: string): string {

Evidence 5:



path: src/core/util/frontmatter.ts

line: 103

excerpt:



> const trimmed = value.trim();

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
