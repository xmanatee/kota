---
id: task-security-review-parallel-builder-mode-can-let-two-
title: Security review: Parallel builder mode can let two runs believe they own the same stale task claim because stale recovery renames the active claim file without verifying it still contains the stale claim that was previously read.
status: done
priority: p2
area: security
summary: Parallel builder mode can let two runs believe they own the same stale task claim because stale recovery renames the active claim file without verifying it still contains the stale claim that was previously read.
created_at: 2026-06-28T17:47:42.365Z
updated_at: 2026-06-28T17:54:04.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/task-claim-operations.ts
claim:

> Parallel builder mode can let two runs believe they own the same stale task claim because stale recovery renames the active claim file without verifying it still contains the stale claim that was previously read.

## Desired Outcome

> Make stale claim replacement compare-and-swap safe: re-read or atomically rename only when the file still matches the stale claim identity/content, otherwise return a write-conflict. Add a concurrent stale-claim replacement test. Reproduction artifact: .kota/runs/2026-06-28T17-29-39-895Z-security-review-wj8dzk/task-claim-stale-race-reproduction.json

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-28T17-29-39-895Z-security-review-wj8dzk.

finding id: task-claim-stale-recovery-race
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/builder/workflow.ts:176
verdict: confirmed
rationale:

> Parallel builder dispatch can run two claim steps at once when branch-per-task mode enables maxConcurrentRuns=2. The stale replacement path reads a claim, decides it is safe to retry, then calls archiveClaim, which blindly renameSyncs the current active claim path to history without verifying it still contains the stale claim that was inspected. If another run has already archived the stale file and written its new claim, the later archive can rename that new active claim away and then write its own claim with wx, so both runs can return claimed=true for the same task. Existing race coverage only checks fresh same-task claims, not concurrent stale replacement.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/builder/builder-config.ts

line: 12

excerpt:



> return builderWorktreeModeEnabledFromConfig(config) ? 2 : 1;

Evidence 2:



path: src/modules/autonomy/task-claim-operations.ts

line: 48

excerpt:



> const existing = readActiveTaskClaim(input.projectDir, input.taskId);

Evidence 3:



path: src/modules/autonomy/task-claim-operations.ts

line: 75

excerpt:



> archiveClaim(input.projectDir, path, existing, now);

Evidence 4:



path: src/modules/autonomy/task-claim-files.ts

line: 168

excerpt:



> renameSync(path, historyPath);

Evidence 5:



path: src/modules/autonomy/task-claim-operations.ts

line: 83

excerpt:



> writeClaim(path, claim, "wx");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion Evidence

- `claimTask` now calls `archiveClaimIfUnchanged`, which takes a per-task mutation lock, re-reads the active claim, and archives only when the file still matches the stale claim already inspected. Changed claims return `write-conflict`.
- `src/modules/autonomy/task-claim-races.test.ts` covers two replacement workers that both captured the same stale claim before racing; exactly one wins and the loser records `write-conflict`.
- Verification: `pnpm test src/modules/autonomy/task-claim-races.test.ts src/modules/autonomy/task-claim-recovery.test.ts`; `pnpm typecheck`; `pnpm lint`; `pnpm validate-tasks`; source-size checks against the staged index.
