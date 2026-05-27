---
id: task-security-review-computeruse-resolves-gui-helper-bi
title: Security review: computer_use resolves GUI helper binaries through the inherited PATH and then executes bare command names, so a PATH-controlled xdotool, cliclick, or osascript can turn an approved GUI action into arbitrary process execution.
status: done
priority: p2
area: security
summary: computer_use resolves GUI helper binaries through the inherited PATH and then executes bare command names, so a PATH-controlled xdotool, cliclick, or osascript can turn an approved GUI action into arbitrary process execution.
created_at: 2026-05-27T12:51:31.499Z
updated_at: 2026-05-27T15:15:39Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/execution/computer-use-actions-linux.ts
claim: computer_use resolves GUI helper binaries through the inherited PATH and then executes bare command names, so a PATH-controlled xdotool, cliclick, or osascript can turn an approved GUI action into arbitrary process execution.

## Desired Outcome

Resolve GUI helper executables to trusted absolute paths before use, execute the resolved path consistently, reject project-local or otherwise untrusted PATH hits, and add Linux/macOS regression tests that prove PATH-precedence spoofing cannot hijack computer_use.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T12-43-57-959Z-security-review-84ijn1.

finding id: computer-use-helper-path-hijack
candidate id: tool-execution:src/modules/execution/computer-use-actions-linux.ts:50
verdict: confirmed
rationale: Linux checks availability with a bare PATH lookup at src/modules/execution/computer-use-actions-linux.ts:31 and later executes bare "xdotool" at line 50. macOS similarly checks bare "cliclick" at src/modules/execution/computer-use-actions-mac.ts:33 and executes bare "osascript"/"cliclick" at lines 43, 59, 70, 88, 98, 108, 114, and 162. There is no absolute helper resolution or trusted-path check, so child_process resolves these helpers through the inherited PATH before running the approved computer_use action.

Evidence:

- src/modules/execution/computer-use-actions-linux.ts:31 - execFileSync("which", ["xdotool"], { timeout: 2000, stdio: "pipe" });
- src/modules/execution/computer-use-actions-linux.ts:50 - return execFileSync("xdotool", args, {
- src/modules/execution/computer-use-actions-mac.ts:33 - execFileSync("which", ["cliclick"], { timeout: 2000, stdio: "pipe" });
- src/modules/execution/computer-use-actions-mac.ts:43 - return execFileSync("osascript", ["-e", script], {
- src/modules/execution/computer-use-actions-mac.ts:59 - execFileSync("cliclick", [`c:${x},${y}`], EXEC_OPTS);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Implemented trusted absolute helper resolution in `src/modules/execution/computer-use-trusted-executables.ts`; Linux/macOS action modules execute the returned path instead of bare command names.
- Added regression coverage for PATH-precedence spoofing of `xdotool`, `cliclick`, and `osascript`.
- Verification passed: `pnpm test src/modules/execution/computer-use-actions-linux.test.ts src/modules/execution/computer-use-actions-mac.test.ts src/modules/execution/computer-use.test.ts`; `pnpm exec biome check src/modules/execution/computer-use-trusted-executables.ts src/modules/execution/computer-use-actions-linux.ts src/modules/execution/computer-use-actions-mac.ts src/modules/execution/computer-use-actions-linux.test.ts src/modules/execution/computer-use-actions-mac.test.ts src/modules/execution/computer-use.test.ts`; `pnpm typecheck`.
