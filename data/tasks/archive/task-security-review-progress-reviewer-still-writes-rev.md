---
status: done
---

# Security review: Progress-reviewer still writes review-agent frontmatter fields with the flat serializer after only control-character and whitespace normalization. Bracket-wrapped scalar values such as `[security]` or `[a, b]` are parsed by the repo frontmatter reader as arrays, so untrusted review output can create malformed required task metadata and poison the task queue instead of being preserved as scalar text.

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts
claim:

> Progress-reviewer still writes review-agent frontmatter fields with the flat serializer after only control-character and whitespace normalization. Bracket-wrapped scalar values such as `[security]` or `[a, b]` are parsed by the repo frontmatter reader as arrays, so untrusted review output can create malformed required task metadata and poison the task queue instead of being preserved as scalar text.

## Desired Outcome

> Quote or escape generated frontmatter scalar values, or reject bracket-list syntax after normalization, and add regression coverage for `[value]` and `[a, b]` in generated title/area/summary fields.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-01T21-45-03-003Z-security-review-qke8lq.

finding id: finding-progress-reviewer-frontmatter-bracket-scalar-type-confusion
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts:335
verdict: confirmed
rationale:

> Confirmed. progress-reviewer accepts follow-up task title/summary/area as non-empty strings without bracket-syntax restrictions, normalizeFrontMatterScalar only removes control characters and collapses whitespace, and writeFollowUpTask passes those values directly to serializeFlatFrontMatter. parseFlatFrontMatter then converts any value beginning with '[' and ending with ']' into a string array, while task validation requires title, area, and summary to be strings. An end-to-end probe of applyProgressReviewActions with title '[security]', area '[a, b]', and summary '[x]' produced parsed array values and task validation reported the three required fields missing.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 178

excerpt:

> function normalizeFrontMatterScalar(field: string, value: string): string {

Evidence 2:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 179

excerpt:

> const normalized = replaceCharacters(value, isControlCharacter, " ")

Evidence 3:

path: src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts

line: 324

excerpt:

> const attrs: TaskAttrs = {

Evidence 4:

path: src/core/util/frontmatter.ts

line: 32

excerpt:

> if (val.startsWith("[") && val.endsWith("]")) {

Evidence 5:

path: src/modules/repo-tasks/task-queue-validation.ts

line: 691

excerpt:

> if (typeof attrs[attr] !== "string" || String(attrs[attr]).trim().length === 0) {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Result

- Shared flat frontmatter serialization now quotes string scalars that would otherwise parse as arrays, while the parser reads double-quoted scalars before applying bracket-array syntax.
- Progress-reviewer regression coverage creates a generated follow-up task with title `[security]`, area `[a, b]`, and summary `[x]` and verifies the repo frontmatter reader preserves all three as strings.

## Verification

- `pnpm test src/core/util/frontmatter.test.ts`
- `pnpm test src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts -- --runInBand`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm validate-tasks`
