---
id: task-security-review-the-new-supervision-load-report-ca
title: Security review: The new supervision-load report can render pending approval tool text from approval records without stripping terminal control sequences. Approval CLI output sanitizes this same class of text, but the report path reads the stored tool name, places it into a top-reference reason, and writes it through the generic renderer, which emits span text directly. A hostile MCP/imported tool name or malformed approval record could forge or hide text in an operator-facing report.
status: done
priority: p2
area: security
task_class: Safety
summary: The new supervision-load report can render pending approval tool text from approval records without stripping terminal control sequences. Approval CLI output sanitizes this same class of text, but the report path reads the stored tool name, places it into a top-reference reason, and writes it through the generic renderer, which emits span text directly. A hostile MCP/imported tool name or malformed approval record could forge or hide text in an operator-facing report.
created_at: 2026-07-07T20:34:38.403Z
updated_at: 2026-07-07T20:49:35.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/report/render-supervision-load.ts
claim:

> The new supervision-load report can render pending approval tool text from approval records without stripping terminal control sequences. Approval CLI output sanitizes this same class of text, but the report path reads the stored tool name, places it into a top-reference reason, and writes it through the generic renderer, which emits span text directly. A hostile MCP/imported tool name or malformed approval record could forge or hide text in an operator-facing report.

## Desired Outcome

> Share or duplicate the approval CLI control-character stripping for supervision-load reference fields before rendering, especially approval tool/reason text. Add a regression test with a pending approval whose tool name contains ANSI/OSC/bidi controls and assert rendered `kota report` output contains no raw control sequences.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-07T19-21-44-462Z-security-review-pd04ld.

finding id: finding-supervision-load-approval-terminal-control-injection
candidate id: auth-approval-boundary:src/modules/autonomy/report/supervision-load-references.ts:87
verdict: confirmed
rationale:

> Pending approvals are read from .kota/approvals and decode tool/risk as raw string fields in src/modules/autonomy/report/supervision-load-readers.ts:78 and :230-239. Those fields are interpolated into ref.reason in src/modules/autonomy/report/supervision-load-references.ts:85-90, then rendered through plain text in src/modules/autonomy/report/render-supervision-load.ts:57-65. The renderer preserves span text verbatim in src/modules/rendering/primitive-ctors.ts:60-62 and src/modules/rendering/render-paint.ts:31-37. Queued tool approvals pass block.name into storage without equivalent sanitization via src/core/tools/tool-runner-execute-block.ts:144-153 and src/core/daemon/approval-queue.ts:117-123, while the approval CLI has a dedicated terminal/bidi stripping path in src/modules/approval-queue/cli.ts:76-91 that this report path does not reuse.

Evidence:

Evidence 1:



path: src/modules/autonomy/report/supervision-load-readers.ts

line: 238

excerpt:



> tool: stringField(item.tool) ?? "(unknown tool)",

Evidence 2:



path: src/modules/autonomy/report/supervision-load-references.ts

line: 90

excerpt:



> reason: `${approval.tool} approval (${approval.risk})`,

Evidence 3:



path: src/modules/autonomy/report/render-supervision-load.ts

line: 64

excerpt:



> plain(` ${ref.id}${workflow}${task}${scope} - ${ref.reason}`),

Evidence 4:



path: src/modules/rendering/render-paint.ts

line: 37

excerpt:



> return `${opens}${span.text}\x1b[0m`;

Evidence 5:



path: src/modules/approval-queue/cli.ts

line: 82

excerpt:



> function stripApprovalTextControls(value: string): string {

Evidence 6:



path: src/core/tools/tool-runner-approval-queue.ts

line: 21

excerpt:



> return getApprovalQueue().enqueue(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/autonomy/report/report-cli-supervision-load.test.ts src/modules/approval-queue/cli.test.ts` (captured in `.kota/runs/2026-07-07T20-43-29-224Z-builder-q5zrlu/verification.txt`)
- `pnpm typecheck`
- `pnpm exec biome check src/modules/rendering/safe-terminal-text.ts src/modules/approval-queue/cli.ts src/modules/autonomy/report/render-supervision-load.ts src/modules/autonomy/report/report-cli-supervision-load.test.ts`
