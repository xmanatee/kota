---
id: task-security-review-native-cli-harnesses-inherit-the-d
title: Security review: Native CLI harnesses inherit the daemon's complete process environment, while Codex removes only OPENAI_API_KEY. The shared sandbox also retains the host HOME and permits default file reads and network access. Native agent tools can therefore inspect unrelated environment secrets and host credential files and transmit them outside the intended project or session boundary.
status: ready
priority: p1
area: security
task_class: Safety
summary: Native CLI harnesses inherit the daemon's complete process environment, while Codex removes only OPENAI_API_KEY. The shared sandbox also retains the host HOME and permits default file reads and network access. Native agent tools can therefore inspect unrelated environment secrets and host credential files and transmit them outside the intended project or session boundary.
created_at: 2026-08-03T20:38:28.340Z
updated_at: 2026-08-03T20:38:28.340Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/cli-runner.ts
claim:

> Native CLI harnesses inherit the daemon's complete process environment, while Codex removes only OPENAI_API_KEY. The shared sandbox also retains the host HOME and permits default file reads and network access. Native agent tools can therefore inspect unrelated environment secrets and host credential files and transmit them outside the intended project or session boundary.

## Desired Outcome

> Construct native-child environments from a central minimal allowlist instead of process.env, remap HOME to the invocation root, and project only the specific executable, locale, temporary-directory, and authentication material each harness requires. Deny reads outside the project and isolated runtime where practical, mediate egress for untrusted workloads, and add tests proving unrelated provider, GitHub, notification, and cloud credential variables are absent.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T18-46-02-385Z-security-review-0pumcq.

finding id: security-review-native-cli-inherits-host-secrets
candidate id: secret-handling:src/modules/codex-agent-harness/cli-runner.ts:49
verdict: confirmed
rationale:

> buildCodexEnvironment copies process.env and removes only OPENAI_API_KEY; withProtectedGitBareRepositoryEnv only rewrites Git configuration variables. The isolated runtime changes CODEX_HOME but preserves HOME and every other inherited variable. The sandbox permits host filesystem reads except for narrowly listed operator-token paths and does not isolate network access. Native agents can therefore access unrelated environment credentials and readable host secret files and transmit them externally. The Antigravity and Gemini CLI runners use the same full-environment inheritance pattern.

Evidence:

Evidence 1:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 48

excerpt:



> const env = withProtectedGitBareRepositoryEnv({ ...process.env, ...(overrides ?? {}) }); delete env.OPENAI_API_KEY;

Evidence 2:



path: src/modules/antigravity-cli-agent-harness/cli-runner.ts

line: 152

excerpt:



> env: withProtectedGitBareRepositoryEnv({ ...process.env, ...(args.env ?? {}), NO_COLOR: "1" }),

Evidence 3:



path: src/modules/gemini-cli-agent-harness/cli-runner.ts

line: 188

excerpt:



> env: withProtectedGitBareRepositoryEnv({ ...process.env, ...(args.env ?? {}), NO_COLOR: "1" }),

Evidence 4:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 69

excerpt:



> "(version 1)", "(allow default)", followed only by targeted file-write and token-path read denials.

Evidence 5:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 22

excerpt:



> return { ...env, CODEX_HOME: runtimeHome };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
