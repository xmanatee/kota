---
status: done
---

# Security review: The get_secret tool writes an approved credential into the daemon's process.env. Subsequent shell or code executions inherit that global environment regardless of their session or project, allowing one approval to expose the credential to unrelated concurrent and future sessions.

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

## Result

Implemented a live session-and-project environment overlay in
`src/core/tools/session-environment.ts`. `get_secret` now writes only to that
overlay, execution subprocesses receive only the overlay for their exact
session and scope, and classic plus workflow-harness session teardown erases
the overlay. Harness tool-runtime session ids are distinct from workflow trace
spans, so concurrent foreach agents cannot share an overlay. KOTA-routable
OpenAI, Gemini, and Vercel adapters receive the exact session context, while
persistent Telegram harness conversations retain it only until clear, project
switch, or shutdown. Long-lived REPL and background processes are terminated
when the owning session closes, and REPLs restart when their scoped environment
changes. The daemon's `process.env` is never mutated by either `get_secret` or
`SecretStore`.

Eval-harness provider credentials and proxies remain protected: execution
captures the inherited provider-egress boundary before overlays merge and
enforces it afterward, so neither `get_secret` nor caller-supplied environment
values can restore filtered provider authentication.

Approval, moderate-risk classification, and autonomy-mode gating remain in
place. An approved invocation also fails closed when its originating session
is no longer live.

## Verification

- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/core/tools/session-environment.test.ts src/core/agent-harness/runner-session-environment.test.ts src/core/agent-harness/runner.test.ts src/core/agent-harness/neutral-protocol-shape.test.ts src/core/loop/loop-session-environment.test.ts src/core/loop/loop-send-mcp-declaration.test.ts src/core/loop/loop.test.ts src/core/workflow/steps/step-executor-foreach.test.ts src/modules/secrets/index.test.ts src/modules/execution/execution-env.test.ts src/modules/execution/repl-session.test.ts src/modules/execution/process.test.ts src/modules/execution/process-lifecycle-edge-cases.test.ts src/modules/openai-tools-agent-harness/adapter-token-budget.test.ts src/modules/openai-tools-agent-harness/adapter-session-resume.test.ts src/modules/gemini-agent-harness/adapter-token-budget.test.ts src/modules/vercel-agent-harness/adapter-guardrails.test.ts src/modules/telegram/harness-session-agent.test.ts src/modules/telegram/bot.test.ts src/modules/telegram/telegram-project-scope.integration.test.ts --configLoader runner` — passed (231 tests).
- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/core/tools/session-environment.test.ts src/core/agent-harness/runner-session-environment.test.ts src/core/agent-harness/runner.test.ts src/core/loop/loop-session-environment.test.ts src/core/loop/loop-send-mcp-declaration.test.ts src/core/loop/loop.test.ts src/modules/secrets/index.test.ts src/modules/execution/execution-env.test.ts src/modules/execution/repl-session.test.ts src/modules/execution/process.test.ts src/modules/execution/process-lifecycle-edge-cases.test.ts --configLoader runner` — passed (121 tests).
- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/core/tools/tool-runner.test.ts src/modules/approval-queue/execution-scope.test.ts src/modules/execution/code-exec.test.ts --configLoader runner` — passed (105 tests).
- `./node_modules/.bin/tsc --noEmit` — passed.
- `./node_modules/.bin/biome check src/` — passed (2,832 files).
- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/strict-types-policy.integration.test.ts src/root-layout.test.ts src/core/agent-harness/no-module-imports-in-core.test.ts src/core/modules/module-deps.test.ts --configLoader runner` — passed (7 tests).
- `NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/built-cli-mcp-server.integration.test.ts src/package-bin.integration.test.ts src/preset-parity.integration.test.ts --configLoader runner` — passed (8 tests; 10 platform/configuration cases skipped).
- `node dist/validate-queue.js` — passed.
- Builder repair checks passed for task resolution, claimed commit set, autonomy-change decision coverage, and severe source size; the remaining three source-size notices are advisory, including a 110-line net reduction to the existing Telegram bot file.
- A full direct Vitest run passed 12,161 tests and exposed only environment/bootstrap failures: compiled artifacts had not yet been built, and the installed `pnpm` wrapper refused its registry fetch because its signature could not be verified. The compiled artifacts were then built successfully and the focused compiled-CLI tests were rerun separately. No package-manager security protection was bypassed.
