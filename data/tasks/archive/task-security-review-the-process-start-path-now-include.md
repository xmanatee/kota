---
status: done
---

# Security review: The process start path now includes live partial stdout/stderr in the initial tool result but does not apply the existing MAX_OUTPUT_CHARS truncation, so a background command that emits a long line without a newline during the startup wait can return an unbounded tool result and bloat persisted command-output artifacts.

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/modules/execution/process-core.ts
claim:

> The process start path now includes live partial stdout/stderr in the initial tool result but does not apply the existing MAX_OUTPUT_CHARS truncation, so a background command that emits a long line without a newline during the startup wait can return an unbounded tool result and bloat persisted command-output artifacts.

## Desired Outcome

> Apply truncateOutput to the initial output returned by startProcess, and add a regression test where a long-running process writes a partial line larger than MAX_OUTPUT_CHARS before newline or exit.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T14-33-33-721Z-security-review-3izxvk.

finding id: process-start-initial-partial-output-unbounded
candidate id: mcp-transport:src/modules/execution/process-core.ts:116
verdict: confirmed
rationale:

> Confirmed. processChunk keeps no-newline stdout/stderr in partial buffers without a size cap, displayLines appends those partials directly, and startProcess returns displayLines(...).slice(-10).join("\n") in the Initial output block without calling truncateOutput. The later output action does call truncateOutput, so the cap is not applied consistently. The reviewed range also added a partial-output start test, but it only covers a short string and does not exercise a long partial line.

Evidence:

Evidence 1:

path: src/modules/execution/process-core.ts

line: 65

excerpt:

> function truncateOutput(text: string): string {

Evidence 2:

path: src/modules/execution/process-core.ts

line: 74

excerpt:

> function displayLines(mp: ManagedProcess): string[] {

Evidence 3:

path: src/modules/execution/process-core.ts

line: 169

excerpt:

> const initial = displayLines(mp).slice(-10).join("\n");

Evidence 4:

path: src/modules/execution/process-core.ts

line: 180

excerpt:

> (initial ? `\nInitial output:\n${initial}` : "\n(no output yet)"),

Evidence 5:

path: src/modules/execution/process-core.ts

line: 202

excerpt:

> (output ? truncateOutput(output) : "(no output)"),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Fixed in `src/modules/execution/process-core.ts` by applying `truncateOutput` to the initial output returned by `startProcess`.
- Added regression coverage in `src/modules/execution/process.test.ts` for a long-running process that writes a 25,000-character partial stdout line before newline or exit.
- Verification passed: `pnpm test src/modules/execution/process.test.ts`; `pnpm exec biome check src/modules/execution/process-core.ts src/modules/execution/process.test.ts`; `pnpm typecheck`.
