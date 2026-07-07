---
id: task-security-review-the-supervision-load-report-still-
title: Security review: The supervision-load report still renders workstream scope IDs from workflow trigger payloads without terminal-control stripping, so a queued workflow payload containing ANSI or bidi controls can reach operator terminal output even though top references now sanitize the same class of data.
status: ready
priority: p2
area: security
task_class: Safety
summary: The supervision-load report still renders workstream scope IDs from workflow trigger payloads without terminal-control stripping, so a queued workflow payload containing ANSI or bidi controls can reach operator terminal output even though top references now sanitize the same class of data.
created_at: 2026-07-07T22:28:35.321Z
updated_at: 2026-07-07T22:28:35.321Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/report/render-supervision-load.ts
claim:

> The supervision-load report still renders workstream scope IDs from workflow trigger payloads without terminal-control stripping, so a queued workflow payload containing ANSI or bidi controls can reach operator terminal output even though top references now sanitize the same class of data.

## Desired Outcome

> Sanitize workstream-rendered string fields with safeTerminalLineText before passing them to span/plain, and add a report regression test with an active run whose trigger payload scopeId contains ANSI and bidi controls.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-07T20-28-16-310Z-security-review-q700pz.

finding id: supervision-load-workstream-scope-terminal-controls
candidate id: task-workflow-mutation:src/modules/autonomy/report/render-supervision-load.ts:41
verdict: confirmed
rationale:

> Confirmed. Active run metadata preserves the workflow trigger payload, scopeFromPayload returns payload.scopeId as a string without control stripping, buildWorkstreamGroups carries that value into the workstream group, and renderSupervisionLoad appends it with plain(` scope=${group.scopeId}`). The terminal renderer's paintSpan writes span.text unchanged aside from theme ANSI wrapping, so embedded ANSI/C1/bidi controls in scopeId can reach `kota report` output. Top references sanitize scopeId with safeTerminalLineText, but the workstream path does not.

Evidence:

Evidence 1:



path: src/modules/workflow-ops/index.ts

line: 408

excerpt:



> payload: { ...(options?.payload ?? {}), triggeredAt: new Date().toISOString(),

Evidence 2:



path: src/modules/autonomy/report/supervision-load-workstreams.ts

line: 45

excerpt:



> const payload = run.trigger.payload as KotaJsonObject;

Evidence 3:



path: src/modules/autonomy/report/supervision-load-json.ts

line: 20

excerpt:



> scopeId: stringField(payload.scopeId),

Evidence 4:



path: src/modules/autonomy/report/render-supervision-load.ts

line: 50

excerpt:



> group.scopeId ? plain(` scope=${group.scopeId}`) : plain("")

Evidence 5:



path: src/modules/rendering/primitive-ctors.ts

line: 60

excerpt:



> export function plain(textValue: string): TextSpan { return { text: textValue }; }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
