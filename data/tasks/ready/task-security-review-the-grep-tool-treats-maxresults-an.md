---
id: task-security-review-the-grep-tool-treats-maxresults-an
title: Security review: The grep tool treats max_results and context_lines as numbers via TypeScript casts but does not validate them at runtime before interpolating them into an execSync shell command. A non-number string can inject shell syntax through a tool registered as read-only.
status: ready
priority: p1
area: security
summary: The grep tool treats max_results and context_lines as numbers via TypeScript casts but does not validate them at runtime before interpolating them into an execSync shell command. A non-number string can inject shell syntax through a tool registered as read-only.
created_at: 2026-05-29T04:37:12.340Z
updated_at: 2026-05-29T04:37:12.340Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/filesystem/grep.ts
claim: The grep tool treats max_results and context_lines as numbers via TypeScript casts but does not validate them at runtime before interpolating them into an execSync shell command. A non-number string can inject shell syntax through a tool registered as read-only.

## Desired Outcome

Replace shell-string execution in grep with execFile/spawn using argv arrays, and validate or coerce max_results/context_lines to bounded finite integers inside the runner. Add regression coverage proving string values for numeric fields are rejected and cannot execute shell metacharacters.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T04-27-59-111Z-security-review-739zbl.

finding id: grep-shell-command-injection
candidate id: tool-execution:src/modules/filesystem/grep.ts:138
verdict: confirmed
rationale: Current code still casts input.max_results without runtime validation at src/modules/filesystem/grep.ts:81, interpolates it into shell strings at src/modules/filesystem/grep.ts:112 and src/modules/filesystem/grep.ts:126, and executes the full string with execSync at src/modules/filesystem/grep.ts:138. The tool is registered as read-only at src/modules/filesystem/index.ts:63-65, and the local tool path passes input through to the runner without input_schema enforcement at src/core/tools/index.ts:111-123 and src/core/tools/tool-runner.ts:431-444. A benign probe with max_results set to "1; printf KOTA_GREP_INJECTION_CONFIRMED #" returned the injected stdout, confirming command execution through this read-only tool path.

Evidence:

- src/modules/filesystem/grep.ts:81 - const maxResults = (input.max_results as number) || 50;
- src/modules/filesystem/grep.ts:112 - cmd = `rg -n --no-heading -m ${maxResults}`;
- src/modules/filesystem/grep.ts:138 - const output = execSync(cmd, {
- src/modules/filesystem/index.ts:63 - tool: grepTool,
- src/modules/filesystem/index.ts:65 - effect: readOnlyLocalEffect(),
- src/core/tools/index.ts:122 - const result = await runner(input, context);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
