---
status: done
---

# Security review: Repair-loop check output is now wrapped in an untrusted-content block with a content-derived markdown fence, but the raw failure output is inserted without escaping XML-like boundary markers. A failed project-controlled check can print </untrusted-content> and make following text appear outside the untrusted region in the repair-agent prompt, reintroducing a prompt-injection variant against the repair loop.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/repair-loop.ts
claim:

> Repair-loop check output is now wrapped in an untrusted-content block with a content-derived markdown fence, but the raw failure output is inserted without escaping XML-like boundary markers. A failed project-controlled check can print </untrusted-content> and make following text appear outside the untrusted region in the repair-agent prompt, reintroducing a prompt-injection variant against the repair loop.

## Desired Outcome

> Escape at least <, >, and & before inserting repair-check output into the untrusted-content block, or serialize the output as JSON using the same escaping pattern as workflow trigger payloads. Add a regression test where failure.output contains </untrusted-content> plus hostile instructions and assert the rendered untrusted block contains only escaped boundary text.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-30T22-39-09-119Z-security-review-n7pxna.

finding id: repair-loop-untrusted-content-close-tag-breakout
candidate id: tool-execution:src/core/workflow/repair-loop.ts:1
verdict: confirmed
rationale:

> Confirmed. Code-step checks can propagate project-controlled stdout/stderr into thrown Error messages via runCheck, runRepairCheck stores that message as failure.output, and buildRepairPrompt renders failure.output verbatim between <untrusted-content> markers before passing it to runAgentHarness. The renderer only grows the markdown fence for backticks; it does not escape <, >, or &, so a check output containing </untrusted-content> remains raw in the prompt. The workflow trigger payload path has an escapeJsonForUntrustedBlock helper and a regression test asserting raw </untrusted-content> is absent, which shows this boundary marker is treated as security-relevant elsewhere.

Evidence:

Evidence 1:

path: src/modules/autonomy/shared.ts

line: 85

excerpt:

> export function runCheck(command: string, cwd: string, timeoutMs = 120_000): string {

Evidence 2:

path: src/modules/autonomy/shared.ts

line: 94

excerpt:

> const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

Evidence 3:

path: src/modules/autonomy/shared.ts

line: 96

excerpt:

> throw new Error(tailTruncate(rawOutput, RUN_CHECK_OUTPUT_TAIL_LIMIT) || `Command failed: ${command}`);

Evidence 4:

path: src/core/workflow/repair-loop-checks.ts

line: 39

excerpt:

> const output = error instanceof Error ? error.message : String(error);

Evidence 5:

path: src/core/workflow/repair-loop.ts

line: 69

excerpt:

> const output = failure.output.trim();

Evidence 6:

path: src/core/workflow/repair-loop.ts

line: 75

excerpt:

> output,

Evidence 7:

path: src/core/workflow/steps/step-executor-agent-prompt.test.ts

line: 117

excerpt:

> expect(block).toContain("\\u003c/untrusted-content\\u003e");

Evidence 8:

path: src/core/workflow/repair-loop.test.ts

line: 174

excerpt:

> it("wraps repair-check output in an untrusted block with a content-derived fence", () => {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
