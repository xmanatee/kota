---
id: task-security-review-computeruse-gui-helper-subprocesse
title: Security review: computer_use GUI helper subprocesses inherit the full process environment by default, so secrets injected by get_secret into process.env can be exposed to osascript, cliclick, or xdotool even though those helpers do not need credentials.
status: done
priority: p3
area: security
summary: computer_use GUI helper subprocesses inherit the full process environment by default, so secrets injected by get_secret into process.env can be exposed to osascript, cliclick, or xdotool even though those helpers do not need credentials.
created_at: 2026-05-29T10:28:29.986Z
updated_at: 2026-05-29T10:40:02.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/execution/computer-use-actions-shared.ts
claim: computer_use GUI helper subprocesses inherit the full process environment by default, so secrets injected by get_secret into process.env can be exposed to osascript, cliclick, or xdotool even though those helpers do not need credentials.

## Desired Outcome

Run GUI helper subprocesses with an explicit minimal environment, and add macOS/Linux tests proving injected secret env vars are not passed to execFileSync.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T10-20-18-489Z-security-review-a61h02.

finding id: gui-helper-subprocess-secret-env-inheritance
candidate id: tool-execution:src/modules/execution/computer-use-actions-linux.ts:47
verdict: confirmed
rationale: get_secret writes the retrieved value into process.env, while EXEC_OPTS only sets timeout and stdio. The Linux xdotool and macOS cliclick/osascript execFileSync calls pass those options without an env override, so the helper processes inherit the full process environment by default.

Evidence:

- src/modules/secrets/index.ts:76 - process.env[name] = value;
- src/modules/execution/computer-use-actions-shared.ts:1 - export const EXEC_OPTS = { timeout: 5000, stdio: "pipe" as const };
- src/modules/execution/computer-use-actions-linux.ts:47 - return execFileSync(requireXdotool(), args, {
- src/modules/execution/computer-use-actions-mac.ts:68 - execFileSync(helper, [`c:${x},${y}`], EXEC_OPTS);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/execution/computer-use-actions-linux.test.ts src/modules/execution/computer-use-actions-mac.test.ts` passed, covering Linux and macOS secret-env exclusion from `execFileSync`.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm validate-tasks` passed after staging the task move.
