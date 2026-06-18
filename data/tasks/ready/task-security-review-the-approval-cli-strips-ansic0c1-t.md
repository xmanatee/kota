---
id: task-security-review-the-approval-cli-strips-ansic0c1-t
title: Security review: The approval CLI strips ANSI/C0/C1 terminal controls but leaves Unicode bidirectional formatting controls intact in queued approval text. A queued tool call can include those controls in model-supplied input/context and visually spoof the terminal approval display before an operator approves it.
status: ready
priority: p2
area: security
summary: The approval CLI strips ANSI/C0/C1 terminal controls but leaves Unicode bidirectional formatting controls intact in queued approval text. A queued tool call can include those controls in model-supplied input/context and visually spoof the terminal approval display before an operator approves it.
created_at: 2026-06-18T23:00:24.412Z
updated_at: 2026-06-18T23:00:24.412Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/cli.ts
claim: The approval CLI strips ANSI/C0/C1 terminal controls but leaves Unicode bidirectional formatting controls intact in queued approval text. A queued tool call can include those controls in model-supplied input/context and visually spoof the terminal approval display before an operator approves it.

## Desired Outcome

Extend approval CLI sanitization to strip or visibly escape Unicode bidirectional/formatting controls such as U+202A-U+202E and U+2066-U+2069 before rendering approval tool names, inputs, reasons, sources, notes, and context. Add regression coverage for pending and resolved approval output containing bidi controls.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-18T22-10-55-281Z-security-review-amqqnw.

finding id: approval-cli-bidi-control-spoofing
candidate id: auth-approval-boundary:src/modules/approval-queue/cli.ts:77
verdict: confirmed
rationale: src/modules/approval-queue/cli.ts:80-89 removes terminal escape sequences plus C0/C1 controls and normalizes newlines, but it does not remove Unicode format controls such as U+202E. The same sanitized value is rendered for pending input, reason, source, and context at src/modules/approval-queue/cli.ts:144-163 and for resolved notes/reasons/sources at src/modules/approval-queue/cli.ts:167-183. src/core/tools/tool-runner.ts:411-420 and src/core/tools/tool-runner.ts:451-455 enqueue model/tool input and recent conversation context into PendingApproval, while src/core/tools/tool-runner.ts:100-125 shows that context is derived from user/assistant text. A local reproduction showed JSON.stringify({ command: "safe" + U+202E + " --approve all" }) preserves U+202E after the CLI regex. The rendering layer does not neutralize this later: src/modules/rendering/render.ts:33-37 paints line spans directly, src/modules/rendering/render-paint.ts:31-41 returns span.text unchanged apart from optional ANSI wrapping, and src/modules/rendering/transport.ts:67-69 writes the rendered string. Existing tests at src/modules/approval-queue/cli.test.ts:169-191 and src/modules/approval-queue/cli.test.ts:267-283 cover ANSI/C0/C1 stripping but not bidi or other Unicode format controls.

Evidence:

- src/modules/approval-queue/cli.ts:76 - const TERMINAL_ESCAPE_SEQUENCE_PATTERN =
- src/modules/approval-queue/cli.ts:84 - .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
- src/modules/approval-queue/cli.ts:87 - function safeApprovalLineText(value: string): string {
- src/modules/approval-queue/cli.ts:145 - const inputSummary = safeApprovalLineText(JSON.stringify(item.input) ?? "").slice(0, 80);
- src/core/tools/tool-runner.ts:451 - const queued = getApprovalQueue().enqueue(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
