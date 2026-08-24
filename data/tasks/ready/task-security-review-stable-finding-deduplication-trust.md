---
id: task-security-review-stable-finding-deduplication-trust
title: Security review: Stable-finding deduplication trusts task-authored identity metadata and treats terminal tasks as canonical update targets. A confirmed recurring security issue can therefore be merged into a done or dropped task without returning it to the actionable queue, suppressing remediation.
status: ready
priority: p2
area: security
task_class: Safety
summary: Stable-finding deduplication trusts task-authored identity metadata and treats terminal tasks as canonical update targets. A confirmed recurring security issue can therefore be merged into a done or dropped task without returning it to the actionable queue, suppressing remediation.
created_at: 2026-08-24T08:21:59.670Z
updated_at: 2026-08-24T09:45:42.905Z
security_finding_key: sha256:b6ae91a788b8bb9cd6c4255d03384b059e6925c9e82daec1c766173b5808eff6
security_review_runs: [2026-08-24T02-28-34-718Z-security-review-qly4j5, 2026-08-24T08-14-17-227Z-security-review-snv5un]
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/security-review/security-review-task-identity.ts
claim:

> Stable-finding deduplication trusts task-authored identity metadata and treats terminal tasks as canonical update targets. A confirmed recurring security issue can therefore be merged into a done or dropped task without returning it to the actionable queue, suppressing remediation.

## Desired Outcome

> Treat repository task identity fields as untrusted comparison hints and bind canonical security-finding identity to daemon-owned workflow provenance. When revalidation confirms a finding whose task is terminal, reopen it through the task domain or create a new actionable follow-up. Add regression coverage for forged identity fields, legacy body markers, and confirmed recurrences against done or dropped tasks.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-24T02-28-34-718Z-security-review-qly4j5.

Confirmed by security-review workflow runs:

- 2026-08-24T02-28-34-718Z-security-review-qly4j5
- 2026-08-24T08-14-17-227Z-security-review-snv5un

finding id: security-review-terminal-task-dedup-suppresses-recurrence
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/security-review/security-review-tasks.ts:121
verdict: confirmed
rationale:

> The resolver scans tasks in every state and accepts task-authored security_finding_key or legacy body markers as identity. Canonical selection does not exclude terminal states, and task creation preserves the selected path and target.state, leaving recurring confirmed findings in done or dropped. The focused regression test passed and explicitly asserts that a matched done task remains done with no ready replacement.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/security-review/security-review-task-identity.ts

line: 74

excerpt:



> return listFullRepoTasks(projectDir).flatMap((task) => {
>   const file = readVerifiedRepoTaskFile(projectDir, task.state, task.id);

Evidence 2:



path: src/modules/autonomy/workflows/security-review/security-review-task-identity.ts

line: 87

excerpt:



> if (record.attrs[SECURITY_FINDING_KEY_ATTR] === args.key) return [record];
> const legacy = legacyFindingIdentity(record.body);

Evidence 3:



path: src/modules/autonomy/workflows/security-review/security-review-task-identity.ts

line: 100

excerpt:



> const canonical = matches.filter((task) => !task.superseded);

Evidence 4:



path: src/modules/autonomy/workflows/security-review/security-review-task-identity.ts

line: 153

excerpt:



> const target = canonical
>   ? { kind: "update" as const, ...canonical }
>   : nextAvailableSecurityFindingTaskTarget(projectDir, args.baseId);

Evidence 5:



path: src/modules/autonomy/workflows/security-review/security-review-tasks.ts

line: 214

excerpt:



> const attrs: Record<string, string | string[]> = {
>   ...(target.kind === "update" ? target.attrs : {}),
>   id: target.id,
>   title: `Security review: ${safeClaim}`,
>   status: target.state,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
