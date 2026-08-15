---
id: task-security-review-the-browser-module-keeps-one-proce
title: Security review: The browser module keeps one process-global authenticated context and page while tool runners carry no scope or session identity. A browser-enabled session can consequently inspect the page, cookies, and local storage left by another session or hosted scope; relative storage-state paths are also resolved against process.cwd() rather than the selected project.
status: ready
priority: p1
area: security
task_class: Safety
summary: The browser module keeps one process-global authenticated context and page while tool runners carry no scope or session identity. A browser-enabled session can consequently inspect the page, cookies, and local storage left by another session or hosted scope; relative storage-state paths are also resolved against process.cwd() rather than the selected project.
created_at: 2026-08-15T13:48:21.011Z
updated_at: 2026-08-15T13:48:21.011Z
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
