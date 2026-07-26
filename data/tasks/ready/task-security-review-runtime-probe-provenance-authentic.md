---
id: task-security-review-runtime-probe-provenance-authentic
title: Security review: Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.
status: ready
priority: p1
area: security
task_class: Safety
summary: Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.
created_at: 2026-07-26T01:23:53.746Z
updated_at: 2026-07-26T01:23:53.746Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/critic-runtime-probe.ts
claim:

> Runtime Probe provenance authenticates only the task declaration in git HEAD, then executes the named pnpm script from the agent-mutated workspace. Staged or untracked package scripts and test code can therefore run arbitrary host commands from the critic code step, outside the agent tool-approval boundary and without OS containment. Existing tests demonstrate that an untracked package.json script is accepted as a trusted probe.

## Desired Outcome

> Run probes through an OS-contained executor with project-scoped filesystem access, network/process/resource restrictions, or explicit owner approval. Do not treat task-command provenance as authorization for transitively resolved workspace scripts. Add a regression proving staged or untracked package code cannot create an outside-workspace marker.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T23-25-05-242Z-security-review-7qz0ka.

finding id: security-review-runtime-probe-workspace-code-execution
candidate id: tool-execution:src/modules/autonomy/critic-runtime-probe.ts:1
verdict: confirmed
rationale:

> Provenance validation reads only the task declaration from git HEAD (task-probe.ts:139-167), while runTaskProbe executes pnpm against the mutable workspace (task-probe.ts:112-121). The focused test creates an untracked package.json whose script runs Node, commits only data/tasks/ready, and successfully executes that script (critic-runtime-probe.test.ts:27-63; critic-test-fixture.integration.ts:84-108). No OS containment or approval boundary is applied.

Evidence:

Evidence 1:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 28

excerpt:



> const provenance = verifyTaskProbeProvenance({ projectDir, taskPath, probe });

Evidence 2:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 35

excerpt:



> ...runTaskProbe(probe, projectDir),

Evidence 3:



path: src/modules/autonomy/task-probe.ts

line: 114

excerpt:



> const result = spawnSync(probe.executable, probe.args, { cwd: projectDir,

Evidence 4:



path: src/modules/autonomy/task-probe.ts

line: 147

excerpt:



> const sourceContent = readHeadFile(args.projectDir, sourcePath);

Evidence 5:



path: src/modules/autonomy/critic-runtime-probe.test.ts

line: 29

excerpt:



> writePackageJson(dir, { "probe:pass": "node -e \"console.log('probe-output-marker')\"" });

Evidence 6:



path: src/modules/autonomy/critic-test-fixture.integration.ts

line: 91

excerpt:



> runGit(dir, ["add", "data/tasks/ready"]);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
