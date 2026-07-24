---
id: task-security-review-the-git-tool-forwards-unrestricted
title: Security review: The Git tool forwards unrestricted `log` arguments, including Git's file-writing `--output=<path>` option. Non-push calls receive no invocation-specific effect, so the static moderate-risk effect is allowed by default. An agent can therefore use `-1 --format=%B --output=/absolute/path` to overwrite files outside the project without confirmation. A local probe confirmed the command wrote the HEAD commit message to an absolute temporary path.
status: done
priority: p1
area: security
task_class: Safety
summary: The Git tool forwards unrestricted `log` arguments, including Git's file-writing `--output=<path>` option. Non-push calls receive no invocation-specific effect, so the static moderate-risk effect is allowed by default. An agent can therefore use `-1 --format=%B --output=/absolute/path` to overwrite files outside the project without confirmation. A local probe confirmed the command wrote the HEAD commit message to an absolute temporary path.
created_at: 2026-07-24T17:17:05.890Z
updated_at: 2026-07-24T18:21:18.074Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/git/git.ts
claim:

> The Git tool forwards unrestricted `log` arguments, including Git's file-writing `--output=<path>` option. Non-push calls receive no invocation-specific effect, so the static moderate-risk effect is allowed by default. An agent can therefore use `-1 --format=%B --output=/absolute/path` to overwrite files outside the project without confirmation. A local probe confirmed the command wrote the HEAD commit message to an absolute temporary path.

## Desired Outcome

> Parse and allowlist arguments separately for every Git operation. Reject `--output`, configuration overrides, execution-capable options, and other side-effecting flags on read operations; prevent paths outside the project; and add a regression test proving `runGit({op:"log", ...})` cannot create or overwrite an absolute-path target.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T16-55-23-656Z-security-review-07hclw.

finding id: git-log-output-arbitrary-file-overwrite
candidate id: tool-execution:src/modules/git/git-push-regression.test.ts:1
verdict: confirmed
rationale:

> src/modules/git/git.ts:155-156 forwards unrestricted arguments to `git log`; src/modules/git/push-safety.ts:186-189 provides no invocation-specific escalation for `log`; and src/modules/git/index.ts:62-67 leaves it at the default moderate-risk effect. A fresh `runGit` probe was classified moderate and successfully wrote the current HEAD hash to an absolute path outside the project using `--output=<path>`.

Evidence:

Evidence 1:



path: src/modules/git/git.ts

line: 155

excerpt:



> const parts = args ? args.split(/\s+/) : ["--oneline", "-20"];

Evidence 2:



path: src/modules/git/git.ts

line: 156

excerpt:



> const result = await git(["log", ...parts], context);

Evidence 3:



path: src/modules/git/push-safety.ts

line: 188

excerpt:



> if (operation !== "push") return undefined;

Evidence 4:



path: src/modules/git/index.ts

line: 66

excerpt:



> effect: networkWriteEffect(),

Evidence 5:



path: src/core/tools/guardrails.ts

line: 45

excerpt:



> moderate: "allow",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- Command: `node --conditions=source ./node_modules/vitest/vitest.mjs run src/modules/git/*.test.ts --configLoader runner --silent=true`
- Result: 9 Git-module test files passed with 94 tests, including 17 focused argument-boundary regressions that prove direct and parser-confused `log --output` forms cannot create or overwrite an absolute target and an in-project symlink cannot redirect `push` to an external repository.
- Additional checks: `node ./node_modules/typescript/bin/tsc --noEmit` and focused Biome checks passed.
