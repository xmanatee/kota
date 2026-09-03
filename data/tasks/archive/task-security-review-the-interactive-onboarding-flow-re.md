---
status: done
---
# Security review: The interactive onboarding flow renders filesystem-derived names, paths, setup messages, and the confirmation path without terminal-control sanitization. A directory or diagnostic containing ANSI, OSC, bidi, or line-control characters can spoof the operator-facing plan or confirmation prompt.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/daemon-ops/scopes-cli.ts
claim:

> The interactive onboarding flow renders filesystem-derived names, paths, setup messages, and the confirmation path without terminal-control sanitization. A directory or diagnostic containing ANSI, OSC, bidi, or line-control characters can spoof the operator-facing plan or confirmation prompt.

## Desired Outcome

> Sanitize every untrusted onboarding presentation field and confirmation message with the existing terminal-text sanitizer before rendering. Add tests using CSI, OSC, bidi, newline, and other control characters in directory names and diagnostic messages.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-03T09-06-14-140Z-security-review-jv1343.

Confirmed by security-review workflow runs:

- 2026-09-03T09-06-14-140Z-security-review-jv1343

finding id: scope-onboarding-terminal-control-injection
candidate id: secret-handling:src/modules/daemon-ops/scopes-cli.ts:453
verdict: confirmed
rationale:

> Filesystem-derived display names and canonical paths, along with setup and diagnostic messages, flow through plain rendering spans without safeTerminalLineText or stripTerminalTextControls. The renderer preserves ESC/OSC, CSI, bidi controls, and embedded newlines. The confirmation path is also interpolated directly into readline.question, allowing terminal display and prompt spoofing.

Evidence:

Evidence 1:



path: src/modules/daemon-ops/scope-onboarding-presentation.ts

line: 51

excerpt:



> `Scope: ${inspection.displayName} (${inspection.scopeId}); operationId=${inspection.operationId}; directory=${inspection.directoryRoot}; kind=${inspection.kind}; registered=${inspection.registered}; hosting=${inspection.hostingState ?? "not-hosted"}; trust=${inspection.trust?.trusted === true ? "trusted" : "untrusted"}.`

Evidence 2:



path: src/modules/daemon-ops/scopes-cli.ts

line: 390

excerpt:



> print(onboardingLines(describeOnboardingInspection(inspected.inspection)));

Evidence 3:



path: src/modules/daemon-ops/scopes-cli.ts

line: 464

excerpt:



> `Apply onboarding plan ${plan.planId} for ${plan.directoryRoot}?`

Evidence 4:



path: src/modules/rendering/render-paint.ts

line: 32

excerpt:



> if (!theme.supportsAnsi) return span.text;

Evidence 5:



path: src/core/util/confirm.ts

line: 20

excerpt:



> rl.question(`${message} [y/N] `, (answer) => {

## Verification

- The public `scope inspect` command and the `scope add` confirmation boundary now pass all onboarding text through `safeTerminalLineText` before rendering or prompting.
- `src/modules/daemon-ops/scopes-cli.test.ts` passes 15 focused owner tests, including CSI, OSC, C1 CSI, bidi, newline, carriage-return, and C0-control payloads in directory, display-name, guidance, setup, blocker, and plan fields.
- `pnpm check:fast` passes, covering production/test types, repository lint, task integrity, and generated client-binding freshness.
- A production-renderer command probe is retained at `$KOTA_RUN_DIR/scope-onboarding-terminal-sanitization-transcript.md`; it shows safe visible output from adversarial daemon data.
