---
id: task-security-review-repair-loop-check-output-is-embedd
title: Security review: Repair-loop check output is embedded in the repair-agent prompt using fixed triple-backtick fences, while package-script failures can carry raw stdout and stderr into that output. A failed check containing a matching fence can break out of the data block and inject instructions before the repair prompt's actionable directives.
status: done
priority: p2
area: security
summary: Repair-loop check output is embedded in the repair-agent prompt using fixed triple-backtick fences, while package-script failures can carry raw stdout and stderr into that output. A failed check containing a matching fence can break out of the data block and inject instructions before the repair prompt's actionable directives.
created_at: 2026-06-30T19:45:04.443Z
updated_at: 2026-06-30T22:48:35.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/repair-loop.ts
claim:

> Repair-loop check output is embedded in the repair-agent prompt using fixed triple-backtick fences, while package-script failures can carry raw stdout and stderr into that output. A failed check containing a matching fence can break out of the data block and inject instructions before the repair prompt's actionable directives.

## Desired Outcome

> Render each repair-check failure as explicitly untrusted data using a fence length derived from the content, or JSON-escape it in an untrusted-content block. Add a regression test where failure.output contains a fence plus hostile instructions.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-30T15-16-49-617Z-security-review-jtjtlm.

finding id: repair-loop-check-output-prompt-injection
candidate id: task-workflow-mutation:src/core/workflow/repair-loop.ts:72
verdict: confirmed
rationale:

> Confirmed. src/modules/autonomy/shared.ts:85-96 shells package checks and throws raw stdout/stderr on failure; src/core/workflow/repair-loop-checks.ts:38-44 stores that Error.message as failure.output; src/core/workflow/repair-loop.ts:49-77 embeds failure.output.trim() inside fixed triple-backtick fences with no dynamic fence sizing, escaping, or untrusted-content wrapper. src/core/workflow/repair-loop-agent-iteration.ts:99-105 then passes that constructed text directly as the repair harness prompt, so output containing ``` can break out of the intended data block and inject prompt text.

Evidence:

Evidence 1:



path: src/modules/autonomy/shared.ts

line: 94

excerpt:



> const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

Evidence 2:



path: src/modules/autonomy/shared.ts

line: 96

excerpt:



> throw new Error(tailTruncate(rawOutput, RUN_CHECK_OUTPUT_TAIL_LIMIT) || `Command failed: ${command}`);

Evidence 3:



path: src/core/workflow/repair-loop-checks.ts

line: 39

excerpt:



> const output = error instanceof Error ? error.message : String(error);

Evidence 4:



path: src/core/workflow/repair-loop.ts

line: 66

excerpt:



> lines.push(`#\# ${failure.id}`, "```", failure.output.trim(), "```", "");

Evidence 5:



path: src/core/workflow/repair-loop.ts

line: 72

excerpt:



> Fix these issues now. Stage all changes with `git add -A` before stopping

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification: `pnpm test src/core/workflow/repair-loop.test.ts`; `pnpm exec biome check src/core/workflow/repair-loop.ts src/core/workflow/repair-loop.test.ts`; `pnpm typecheck`.
