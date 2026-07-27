---
id: task-security-review-the-getsecret-tool-writes-an-appro
title: Security review: The get_secret tool writes an approved credential into the daemon's process.env. Subsequent shell or code executions inherit that global environment regardless of their session or project, allowing one approval to expose the credential to unrelated concurrent and future sessions.
status: ready
priority: p1
area: security
task_class: Safety
summary: The get_secret tool writes an approved credential into the daemon's process.env. Subsequent shell or code executions inherit that global environment regardless of their session or project, allowing one approval to expose the credential to unrelated concurrent and future sessions.
created_at: 2026-07-27T03:25:52.673Z
updated_at: 2026-07-27T03:25:52.673Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/secrets/index.ts
claim:

> The get_secret tool writes an approved credential into the daemon's process.env. Subsequent shell or code executions inherit that global environment regardless of their session or project, allowing one approval to expose the credential to unrelated concurrent and future sessions.

## Desired Outcome

> Store injected credentials in a session- and project-local environment overlay passed only to executions authorized for that session. Never mutate daemon process.env, clear overlays on session teardown, and add cross-session and cross-project inheritance tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T02-48-33-344Z-security-review-s3q44o.

finding id: get-secret-daemon-global-env-cross-session
candidate id: secret-handling:src/modules/secrets/client.ts:4
verdict: confirmed
rationale:

> The get_secret runner still ignores ToolRunnerContext and assigns the credential directly to process.env. buildExecutionEnv copies that process-wide environment before attaching the calling session id, with no credential cleanup or session-local overlay. A current-head probe confirmed that a value introduced for session A was inherited by an execution environment labeled as session B.

Evidence:

Evidence 1:



path: src/modules/secrets/index.ts

line: 78

excerpt:



> process.env[name] = value;

Evidence 2:



path: src/modules/execution/execution-env.ts

line: 52

excerpt:



> const env = buildFilteredInheritedSubprocessEnv();

Evidence 3:



path: src/core/modules/subprocess-env.ts

line: 13

excerpt:



> inheritedEnv: NodeJS.ProcessEnv = process.env,

Evidence 4:



path: src/core/modules/subprocess-env.ts

line: 18

excerpt:



> env[key] = value;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
