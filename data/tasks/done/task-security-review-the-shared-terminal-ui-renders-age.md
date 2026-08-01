---
id: task-security-review-the-shared-terminal-ui-renders-age
title: Security review: The shared terminal UI renders agent- or user-controlled approval and owner-question text without removing ANSI, OSC, C1, or Unicode bidirectional control characters. Crafted content can spoof operator-visible output or invoke terminal features.
status: done
priority: p2
area: security
task_class: Safety
summary: The shared terminal UI renders agent- or user-controlled approval and owner-question text without removing ANSI, OSC, C1, or Unicode bidirectional control characters. Crafted content can spoof operator-visible output or invoke terminal features.
created_at: 2026-08-01T08:07:21.559Z
updated_at: 2026-08-01T09:04:47.950Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/workflow-ops/ui-runtime-helpers.ts
claim:

> The shared terminal UI renders agent- or user-controlled approval and owner-question text without removing ANSI, OSC, C1, or Unicode bidirectional control characters. Crafted content can spoof operator-visible output or invoke terminal features.

## Desired Outcome

> Sanitize all dynamic shared-UI text at the terminal-rendering boundary using the existing stripTerminalTextControls or safeTerminalLineText utility. Add regression coverage with OSC, CSI/C1, control-character, and bidi payloads in approval and owner-question rows.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T19-51-13-746Z-security-review-6m8reo.

finding id: ui-terminal-control-sequence-injection
candidate id: auth-approval-boundary:src/modules/workflow-ops/ui-runtime-helpers.ts:1
verdict: confirmed
rationale:

> Agent-supplied owner-question text and approval fields reach the shared terminal renderer without safeTerminalLineText or stripTerminalTextControls. The renderer fits and paints the raw strings, and the transport writes them unchanged. A focused runtime probe confirmed OSC, CSI, and Unicode bidi controls all survive in both rendered rows.

Evidence:

Evidence 1:



path: src/modules/workflow-ops/ui-runtime-helpers.ts

line: 116

excerpt:



> { columnId: "detail", value: `${approval.tool}  ${approval.reason}`, role: "muted" },

Evidence 2:



path: src/modules/workflow-ops/ui-runtime-helpers.ts

line: 129

excerpt:



> { columnId: "detail", value: question.question, role: "muted" },

Evidence 3:



path: src/modules/daemon-ops/operator-ui-render.ts

line: 121

excerpt:



> return { spans: [span(`${cell?.value ?? ""}${rowAction}`, cell?.role ?? column.role)] };

Evidence 4:



path: src/modules/rendering/render-paint.ts

line: 32

excerpt:



> if (!theme.supportsAnsi) return span.text;

Evidence 5:



path: src/modules/rendering/render-paint.ts

line: 37

excerpt:



> return `${opens}${span.text}\x1b[0m`;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm exec vitest run src/modules/workflow-ops/ui-surface.test.ts src/modules/daemon-ops/operator-ui.test.ts src/modules/daemon-ops/operator-ui-continuity.test.ts src/modules/daemon-ops/operator-ui-status-recovery.test.ts --configLoader runner`
- Builder evidence: `artifacts/terminal-control-regression.txt`
