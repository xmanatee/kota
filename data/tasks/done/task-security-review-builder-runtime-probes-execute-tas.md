---
id: task-security-review-builder-runtime-probes-execute-tas
title: Security review: Builder runtime probes execute task-declared shell commands directly from task text before critic review, outside the agent tool approval boundary. Any task file that reaches builder review with a Runtime Probe section can trigger host command execution with the workflow environment.
status: done
priority: p2
area: security
summary: Builder runtime probes execute task-declared shell commands directly from task text before critic review, outside the agent tool approval boundary. Any task file that reaches builder review with a Runtime Probe section can trigger host command execution with the workflow environment.
created_at: 2026-06-21T06:00:25.085Z
updated_at: 2026-06-21T06:53:52.299Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/task-probe.ts
claim:

> Builder runtime probes execute task-declared shell commands directly from task text before critic review, outside the agent tool approval boundary. Any task file that reaches builder review with a Runtime Probe section can trigger host command execution with the workflow environment.

## Desired Outcome

> Require explicit trusted provenance or owner approval for Runtime Probe declarations before execution, and route probe execution through the same guarded tool-control path or a constrained command runner with a narrowed environment.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-21T04-29-15-286Z-security-review-r8o2aq.

finding id: security-review-runtime-probe-approval-bypass
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/builder/AGENTS.md:60
verdict: confirmed
rationale:

> Confirmed. The builder repair loop runs createCriticCheck as a code repair check, and the critic calls runProbeIfDeclared before judge review. runProbeIfDeclared extracts a Runtime Probe from taskContent and passes the task-supplied command to spawnSync with shell: true, cwd: projectDir, and env: withProtectedGitBareRepositoryEnv(). That env helper clones process.env and only rewrites Git config env. The local builder guidance also states probes do not route through the agent tool loop or per-tool approval queue.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/builder/AGENTS.md

line: 57

excerpt:



> The critic runs the probe directly via `spawnSync` from its own step,

Evidence 2:



path: src/modules/autonomy/workflows/builder/AGENTS.md

line: 59

excerpt:



> through the agent tool loop, so they are not subject to the per-tool

Evidence 3:



path: src/modules/autonomy/critic.ts

line: 443

excerpt:



> const probeResult = runProbeIfDeclared(taskContent, ctx.projectDir, runDir);

Evidence 4:



path: src/modules/autonomy/task-probe.ts

line: 52

excerpt:



> const command = attrs.command;

Evidence 5:



path: src/modules/autonomy/task-probe.ts

line: 91

excerpt:



> const result = spawnSync(probe.command, {

Evidence 6:



path: src/modules/autonomy/task-probe.ts

line: 92

excerpt:



> shell: true,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification in builder run `2026-06-21T06-45-21-664Z-builder-f6gf4h`: `pnpm test src/modules/autonomy/task-probe.test.ts src/modules/autonomy/critic.test.ts`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` passed after adding the constrained Runtime Probe runner and pre-run task provenance gate.
