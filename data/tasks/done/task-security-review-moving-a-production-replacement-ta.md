---
id: task-security-review-moving-a-production-replacement-ta
title: Security review: Moving a production-replacement task to done executes repository-controlled Vitest files and configuration without isolation and passes the complete daemon environment to the child process. A compromised builder change can therefore read daemon credentials or perform host/network side effects outside its agent write scope through an operation authorized only as task-queue mutation.
status: done
priority: p1
area: security
task_class: Safety
summary: Moving a production-replacement task to done executes repository-controlled Vitest files and configuration without isolation and passes the complete daemon environment to the child process. A compromised builder change can therefore read daemon credentials or perform host/network side effects outside its agent write scope through an operation authorized only as task-queue mutation.
created_at: 2026-08-23T07:37:13.487Z
updated_at: 2026-08-23T07:58:34.621Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/repo-tasks/production-replacement-execution.ts
claim:

> Moving a production-replacement task to done executes repository-controlled Vitest files and configuration without isolation and passes the complete daemon environment to the child process. A compromised builder change can therefore read daemon credentials or perform host/network side effects outside its agent write scope through an operation authorized only as task-queue mutation.

## Desired Outcome

> Run proof tests in a dedicated sandbox with a minimal environment, disabled network, read-only repository projection, isolated writable overlay, and process/resource limits. Do not execute repository code with daemon authority during an ordinary task-move request.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T07-25-44-834Z-security-review-j8wkmk.

finding id: production-replacement-tests-inherit-daemon-authority
candidate id: tool-execution:src/modules/repo-tasks/production-replacement-execution.ts:1
verdict: confirmed
rationale:

> The completion path invokes repository-controlled Vitest files through spawnSync, spreads the complete process.env into the child, and provides no filesystem, network, or process isolation. moveTaskById reaches this path synchronously when moving an eligible task to done, and the existing test fixture demonstrates that executed proof code can write directly to the host working directory.

Evidence:

Evidence 1:



path: src/modules/repo-tasks/production-replacement-execution.ts

line: 45

excerpt:



> const execution = spawnSync("pnpm", ["exec", "vitest", "run", ...args.testArgs, ...], { cwd: args.projectDir, ... });

Evidence 2:



path: src/modules/repo-tasks/production-replacement-execution.ts

line: 59

excerpt:



> env: { ...process.env, DEBUG: "vite:transform", NODE_OPTIONS: nodeOptions },

Evidence 3:



path: src/modules/repo-tasks/repo-tasks-domain.ts

line: 728

excerpt:



> if (toState === "done" && productionReplacementRaw === "true") { const completion = enforceProductionReplacementCompletion(...); }

Evidence 4:



path: src/modules/repo-tasks/routes-lifecycle-handlers.ts

line: 111

excerpt:



> const result = moveTaskById(projectDir, id, state);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/core/agent-harness/task-probe-sandbox.test.ts src/core/agent-harness/task-probe-hard-links.test.ts src/core/agent-harness/task-probe-toolchain.test.ts src/modules/autonomy/task-probe-runner.test.ts src/modules/repo-tasks/production-replacement-execution.test.ts src/modules/repo-tasks/production-replacement-completion.test.ts src/modules/repo-tasks/production-replacement-task-move.test.ts` — 26 passed, 1 platform-skipped.
- `pnpm typecheck` and `pnpm lint` pass.
