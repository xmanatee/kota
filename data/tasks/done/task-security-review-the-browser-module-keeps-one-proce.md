---
id: task-security-review-the-browser-module-keeps-one-proce
title: Security review: The browser module keeps one process-global authenticated context and page while tool runners carry no scope or session identity. A browser-enabled session can consequently inspect the page, cookies, and local storage left by another session or hosted scope; relative storage-state paths are also resolved against process.cwd() rather than the selected project.
status: done
priority: p1
area: security
task_class: Safety
summary: The browser module keeps one process-global authenticated context and page while tool runners carry no scope or session identity. A browser-enabled session can consequently inspect the page, cookies, and local storage left by another session or hosted scope; relative storage-state paths are also resolved against process.cwd() rather than the selected project.
created_at: 2026-08-15T13:48:21.011Z
updated_at: 2026-08-15T14:43:38.336Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/browser/lifecycle.ts
claim:

> The browser module keeps one process-global authenticated context and page while tool runners carry no scope or session identity. A browser-enabled session can consequently inspect the page, cookies, and local storage left by another session or hosted scope; relative storage-state paths are also resolved against process.cwd() rather than the selected project.

## Desired Outcome

> Pass ToolRunnerContext into browser runners and key contexts/pages by at least scopeId and session identity, with teardown bound to session cleanup. Resolve each storage-state path from that scope's project directory and never reuse authenticated state or a current page across scopes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Verification

- `pnpm test src/modules/browser` — 12 files and 83 tests passed, including scope/session isolation, canonical-project storage-state resolution when `cwd` is a worktree, absolute/project-escaping/symlink-escaping profile ownership, and session-cleanup teardown regressions.
- `pnpm test src/core/workflow/run-executor.test.ts src/core/workflow/run-executor-tool-session.test.ts src/core/workflow/steps/step-executor-foreach.test.ts src/core/workflow/run-executor-step.test.ts` — 4 files and 77 tests passed, including distinct invocation sessions and exact resource teardown for direct tool calls from parallel children and concurrent foreach items.
- `pnpm test src/harness-repl.integration.test.ts src/modules/telegram/harness-session-agent.test.ts src/modules/telegram/bot.test.ts src/core/agent-harness/tool-execution-options.test.ts` — 4 files and 65 tests passed, including canonical project propagation through the real REPL and Telegram harness-session paths.
- `pnpm test src/core/workflow/run-executor-step.test.ts src/core/workflow/run-executor-workspace.test.ts src/core/workflow/steps/step-context.test.ts src/core/agent-harness/tool-execution-options.test.ts src/core/loop/loop-send-mcp-declaration.test.ts src/modules/browser/lifecycle.test.ts src/modules/browser/lifecycle-profile.test.ts` — 7 files and 36 tests passed for workflow invocation sessions, cleanup, profile ownership, and separate canonical-project/workspace propagation.
- `pnpm test src/core/agent-harness/runner-session-environment.test.ts src/core/tools/session-environment.test.ts src/core/tools/delegate-runtime-context.test.ts src/core/workflow/steps/step-context-scope-policy.test.ts src/core/workflow/steps/step-context-native-scope-policy.test.ts src/core/loop/loop.test.ts src/modules/approval-queue/local-client-execution.test.ts src/modules/inbound-signals/inbound-signals.test.ts` — the affected nested execution, authority, loop, approval, and inbound-session paths passed.
- `pnpm typecheck` and `pnpm lint` passed.
- `pnpm validate-tasks` passed.

## Source / Intent

Created by security-review workflow run 2026-08-15T12-02-42-516Z-security-review-6w7fq1.

finding id: browser-context-cross-scope-leakage
candidate id: external-fetch:src/modules/browser/tools.ts:42
verdict: confirmed
rationale:

> The lifecycle module stores one process-global context and page, while browser runners ignore the available ToolRunnerContext sessionId, scopeId, projectId, and cwd. That context can retain authenticated state and the current page across sessions and scopes, and relative storage-state paths are resolved using process.cwd() rather than the invoking scope's project directory. Cleanup is module-wide or idle-based, not session-bound.

Evidence:

Evidence 1:



path: src/modules/browser/lifecycle.ts

line: 16

excerpt:



> let pw: PlaywrightModule | null = null;

Evidence 2:



path: src/modules/browser/lifecycle.ts

line: 18

excerpt:



> let context: PlaywrightContext | null = null;

Evidence 3:



path: src/modules/browser/lifecycle.ts

line: 19

excerpt:



> let page: PlaywrightPage | null = null;

Evidence 4:



path: src/modules/browser/lifecycle.ts

line: 68

excerpt:



> const base = projectDir ?? process.cwd();

Evidence 5:



path: src/modules/browser/lifecycle.ts

line: 78

excerpt:



> const storagePath = resolveStoragePath(null);

Evidence 6:



path: src/modules/browser/tools.ts

line: 319

excerpt:



> const page = await getPage();

Evidence 7:



path: src/modules/browser/tools.ts

line: 333

excerpt:



> text = (await page.evaluate("document.body.innerText")) as string;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
