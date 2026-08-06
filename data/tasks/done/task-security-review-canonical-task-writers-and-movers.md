---
id: task-security-review-canonical-task-writers-and-movers
title: Security review: Canonical task writers and movers follow project-controlled symbolic links. A task file or parent-directory symlink can redirect host-side daemon and workflow mutations outside the selected project, including into another project's task queue.
status: done
priority: p1
area: security
task_class: Safety
summary: Canonical task writers and movers follow project-controlled symbolic links. A task file or parent-directory symlink can redirect host-side daemon and workflow mutations outside the selected project, including into another project's task queue.
created_at: 2026-08-06T06:19:49.672Z
updated_at: 2026-08-06T07:32:33.202Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/repo-tasks/repo-file-mutations.ts
claim:

> Canonical task writers and movers follow project-controlled symbolic links. A task file or parent-directory symlink can redirect host-side daemon and workflow mutations outside the selected project, including into another project's task queue.

## Desired Outcome

> Anchor task and inbox mutations to verified real directories beneath the canonical project root. Reject symlinked or non-regular task entries and symlinked parent components, use no-follow or descriptor-anchored writes with identity revalidation, and add regressions for direct task symlinks, parent-directory symlinks, daemon routes, and autonomous host code steps.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-06T05-20-43-383Z-security-review-6g8pnd.

finding id: repo-task-symlink-host-write-boundary
candidate id: task-workflow-mutation:src/modules/repo-tasks/repo-file-mutations.ts:1
verdict: confirmed
rationale:

> The containment checks in repo-file-mutations.ts are lexical and do not resolve or reject symlinked path components. Canonical writers subsequently use writeFileSync, which follows leaf and parent symlinks. moveTaskById likewise accepts an existing symlink as a task, reads through it, renames the symlink, and then writes through the renamed destination without verifying a regular-file identity. The cited probe reproduces an outside-project target mutation, while daemon handlers and the backlog-promoter invoke these operations from host-side code without an intervening physical-path boundary check.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/repo-file-mutations.ts

line: 30

excerpt:



> relativePathWithin checks relative(resolve(rootDir), resolve(filePath)), which provides lexical containment but does not reject symlinks or resolve their real targets.

Evidence 2:



path: src/modules/repo-tasks/repo-file-mutations.ts

line: 111

excerpt:



> After the lexical check, writeAndStageRepoMarkdownFile calls writeFileSync(args.filePath, ...), following a symlinked leaf or parent.

Evidence 3:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 693

excerpt:



> moveTaskById renames the selected entry and then calls writeFileSync(dstPath, updated) without requiring the entry to be a regular file, so a moved symlink remains a symlink and its external target is rewritten.

Evidence 4:



path: src/modules/autonomy/workflows/backlog-promoter/workflow.ts

line: 85

excerpt:



> The host-side apply-promotion code step invokes moveTaskById directly for selected project tasks.

Evidence 5:



path: .kota/runs/2026-08-06T05-20-43-383Z-security-review-6g8pnd/repo-task-symlink-probe.json

line: 1

excerpt:



> A temporary Git fixture confirmed that moveTaskById returned success, left the destination as a symlink to an outside-project file, and changed that external target's status to doing.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verified on 2026-08-06 with `pnpm typecheck`; `TMPDIR="$(cd "${TMPDIR:-/tmp}" && pwd -P)" NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=true src/modules/repo-tasks/repo-tasks-operations.test.ts src/modules/repo-tasks/repo-task-path-safety.test.ts src/modules/repo-tasks/repo-mutation-parent-race.test.ts src/modules/repo-tasks/repo-task-move-staging.test.ts src/modules/repo-tasks/repo-task-native-staging.test.ts src/modules/repo-tasks/routes-state.test.ts src/modules/repo-tasks/routes-create.test.ts src/modules/repo-tasks/routes-maintenance.test.ts src/modules/retract/contributors.test.ts src/modules/capture/contributors.test.ts src/modules/autonomy/workflows/backlog-promoter/workflow.test.ts src/modules/autonomy/workflows/backlog-promoter/path-safety.test.ts src/strict-types-policy.integration.test.ts src/core/modules/module-deps.test.ts src/retract-pipeline.integration.test.ts` (15 files, 92 tests passed); `pnpm validate-tasks`; and `pnpm lint`. The three original failing test files pass 44 of 44 tests together. The post-check CLI integration rerun passes 3 of 3 tests both alone and during the full suite. The managed-sandbox full run passed 12,448 tests; its remaining failures were sandbox-policy EPERMs for the protected runtime parent, loopback listeners, and the unreadable Telegram env example.

## Source Size Exception

kind: source-size-cleanup
files:
- src/modules/autonomy/calibration-repair.ts
- src/modules/autonomy/fan-out-consolidation.ts
- src/modules/autonomy/trajectory-diagnostic-escalation.ts
- src/modules/autonomy/workflow-failure-escalation.ts
- src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.ts
- src/modules/autonomy/workflows/progress-reviewer/progress-review/action-writers.ts
- src/modules/repo-tasks/cli.test.ts
- src/modules/repo-tasks/repo-tasks-domain.ts
- src/modules/repo-tasks/repo-tasks-operations.test.ts
