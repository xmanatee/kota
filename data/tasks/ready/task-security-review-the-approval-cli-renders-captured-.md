---
id: task-security-review-the-approval-cli-renders-captured-
title: Security review: The approval CLI renders captured conversation context as raw terminal text, so an untrusted user or assistant message containing ANSI/OSC control sequences can alter the operator's terminal during `kota approval list` and undermine review of a queued tool call.
status: ready
priority: p2
area: security
summary: The approval CLI renders captured conversation context as raw terminal text, so an untrusted user or assistant message containing ANSI/OSC control sequences can alter the operator's terminal during `kota approval list` and undermine review of a queued tool call.
created_at: 2026-05-27T03:03:14.134Z
updated_at: 2026-05-27T03:03:14.134Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/cli.ts
claim: The approval CLI renders captured conversation context as raw terminal text, so an untrusted user or assistant message containing ANSI/OSC control sequences can alter the operator's terminal during `kota approval list` and undermine review of a queued tool call.

## Desired Outcome

Add an untrusted-terminal-text escaping or stripping helper for approval CLI fields sourced from conversation/tool data, including context, source, and any future raw queue text. Cover ESC/OSC sequences in approval CLI tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T02-52-17-351Z-security-review-mykpa4.

finding id: approval-cli-terminal-control-sequence-injection
candidate id: auth-approval-boundary:src/modules/approval-queue/cli.ts:129
verdict: confirmed
rationale: Approval context is built directly from recent user/assistant message text in src/core/tools/tool-runner.ts and stored on queued approvals. src/modules/approval-queue/cli.ts renders the last context line through plain text spans, and src/modules/rendering/render-paint.ts returns span text unchanged apart from KOTA's own styling. A local render probe confirmed ESC/OSC bytes are preserved in output, so untrusted conversation text can reach the operator terminal during approval review.

Evidence:

- src/core/tools/tool-runner.ts:63 - lines.unshift(`${prefix}: ${text.trim()}`);
- src/modules/approval-queue/cli.ts:102 - const lastLine = item.context.split("\n").filter(Boolean).at(-1) ?? "";
- src/modules/approval-queue/cli.ts:103 - rows.push(line(span("    Why:    ", "muted"), plain(lastLine.slice(0, 120))));
- src/modules/rendering/render-paint.ts:32 - if (!theme.supportsAnsi) return span.text;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
