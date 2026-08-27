---
status: done
---

# Security review: The macOS computer-use fallback interpolates tool-controlled text into AppleScript source. Its quoting helper handles double quotes but does not escape backslashes, allowing crafted text to terminate or reshape the string expression and execute additional AppleScript commands rather than merely typing text.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/execution/computer-use-actions-mac.ts
claim:

> The macOS computer-use fallback interpolates tool-controlled text into AppleScript source. Its quoting helper handles double quotes but does not escape backslashes, allowing crafted text to terminate or reshape the string expression and execute additional AppleScript commands rather than merely typing text.

## Desired Outcome

> Use a fixed AppleScript handler that receives text through argv instead of interpolating it into source. Add regressions for backslashes adjacent to quotes, comments, newlines, and other AppleScript metacharacters, verifying that input is always treated solely as text.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T10-43-27-309Z-security-review-03tlkp.

finding id: finding-macos-computer-use-applescript-injection
candidate id: tool-execution:src/modules/execution/computer-use-actions-mac.ts:1
verdict: confirmed
rationale:

> The osascript fallback constructs executable AppleScript source containing tool-controlled text. asString handles double quotes but leaves backslashes and control characters unencoded, so AppleScript escape semantics can alter the generated expression's lexical boundaries. The resulting source is passed directly through osascript -e.

Evidence:

Evidence 1:

path: src/modules/execution/computer-use-actions-mac.ts

line: 50

excerpt:

> return execFileSync(osascriptPath(), ["-e", script], {

Evidence 2:

path: src/modules/execution/computer-use-actions-mac.ts

line: 57

excerpt:

> function asString(text: string): string {

Evidence 3:

path: src/modules/execution/computer-use-actions-mac.ts

line: 58

excerpt:

> if (!text.includes('"')) return `"${text}"`;

Evidence 4:

path: src/modules/execution/computer-use-actions-mac.ts

line: 131

excerpt:

> `tell application "System Events" to keystroke ${asString(text)}`

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- The macOS fallback now invokes a fixed `on run argv` keystroke handler and
  passes typed text after `--`; tool-controlled text is no longer part of the
  AppleScript source.
- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node node_modules/vitest/vitest.mjs run src/modules/execution --configLoader runner --silent=true`
  passed with 20 test files and 347 tests, including crafted backslash/quote,
  comment, newline, and AppleScript-metacharacter payloads.
- `node node_modules/@biomejs/biome/bin/biome check src/modules/execution/computer-use-actions-mac.ts src/modules/execution/computer-use-actions-mac.test.ts src/modules/execution/computer-use.test.ts`
  passed.
- `/usr/bin/osacompile -e 'on run argv' -e 'tell application "System Events" to keystroke (item 1 of argv)' -e 'end run'`
  compiled the fixed handler successfully without executing it.
