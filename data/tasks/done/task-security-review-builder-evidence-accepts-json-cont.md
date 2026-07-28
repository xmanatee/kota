---
id: task-security-review-builder-evidence-accepts-json-cont
title: Security review: Builder evidence accepts JSON containing duplicate object keys. JSON.parse discards shadowed values, the redaction comparison examines only the surviving value, and the original bytes are then projected and staged. A shadowed credential can therefore enter durable Git evidence.
status: done
priority: p1
area: security
task_class: Safety
summary: Builder evidence accepts JSON containing duplicate object keys. JSON.parse discards shadowed values, the redaction comparison examines only the surviving value, and the original bytes are then projected and staged. A shadowed credential can therefore enter durable Git evidence.
created_at: 2026-07-28T10:54:24.521Z
updated_at: 2026-07-28T11:03:40.702Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/builder/agent-run-evidence-manifest.ts
claim:

> Builder evidence accepts JSON containing duplicate object keys. JSON.parse discards shadowed values, the redaction comparison examines only the surviving value, and the original bytes are then projected and staged. A shadowed credential can therefore enter durable Git evidence.

## Desired Outcome

> Reject duplicate JSON object keys before parsing, or project canonical serialization of the screened parsed value instead of the original bytes. Apply the rule to JSON, JSONL, and the evidence manifest, with a regression covering a shadowed sensitive key.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T10-43-27-309Z-security-review-03tlkp.

finding id: finding-builder-evidence-duplicate-json-key-redaction-bypass
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/builder/agent-run-evidence-manifest.ts:1
verdict: confirmed
rationale:

> JSON.parse applies last-key-wins semantics. Screening therefore examines only surviving properties, while projectTypedContent returns the original bytes for JSON and JSONL. The original manifest bytes are likewise projected. No duplicate-key rejection closes this structural gap.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/builder/agent-run-evidence-manifest.ts

line: 69

excerpt:



> parsed = JSON.parse(content.toString("utf8")) as KotaJsonValue;

Evidence 2:



path: src/modules/autonomy/workflows/builder/agent-run-evidence-policy.ts

line: 122

excerpt:



> value = JSON.parse(line) as KotaJsonValue;

Evidence 3:



path: src/modules/autonomy/workflows/builder/agent-run-evidence-policy.ts

line: 128

excerpt:



> return content;

Evidence 4:



path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts

line: 110

excerpt:



> writeStableBuilderEvidenceProjection(workspaceRoot, destination, file.projectedContent);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/autonomy/workflows/builder/agent-run-evidence-policy.test.ts src/modules/autonomy/workflows/builder/agent-run-artifacts.test.ts src/modules/autonomy/workflows/builder/agent-run-evidence-projection.test.ts` — 3 files and 11 tests passed.
