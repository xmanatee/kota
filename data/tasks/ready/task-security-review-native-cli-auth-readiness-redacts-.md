---
id: task-security-review-native-cli-auth-readiness-redacts-
title: Security review: Native CLI auth readiness redacts email addresses for stale and expiring states, but the ready path keeps raw command output in probe.detail. Doctor JSON and daemon-control doctor output embed presetReadiness metadata, so a normal ready Codex login status containing an account identifier can be exposed.
status: ready
priority: p3
area: security
task_class: Safety
summary: Native CLI auth readiness redacts email addresses for stale and expiring states, but the ready path keeps raw command output in probe.detail. Doctor JSON and daemon-control doctor output embed presetReadiness metadata, so a normal ready Codex login status containing an account identifier can be exposed.
created_at: 2026-07-08T09:30:31.018Z
updated_at: 2026-07-08T09:30:31.018Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/core/agent-harness/readiness-node-probes.ts
claim:

> Native CLI auth readiness redacts email addresses for stale and expiring states, but the ready path keeps raw command output in probe.detail. Doctor JSON and daemon-control doctor output embed presetReadiness metadata, so a normal ready Codex login status containing an account identifier can be exposed.

## Desired Outcome

> Apply auth-detail redaction to every probeNativeCliAuth branch that returns command output, add ready/missing/unrecognized coverage with account identifiers, and avoid embedding unredacted auth probe detail in doctor metadata.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-08T09-02-31-117Z-security-review-caw6t8.

finding id: security-review-codex-auth-ready-detail-leaks-account
candidate id: tool-execution:src/modules/codex-agent-harness/adapter.test.ts:16
verdict: confirmed
rationale:

> probeNativeCliAuth redacts detail for stale and expiring outputs, but the ready branch returns status.output unchanged. Codex readiness matches ready output containing 'logged in using chatgpt', and runDoctorReport exposes the resulting PresetHarnessReadiness both in check metadata and top-level presetReadiness through the daemon-control doctor JSON route.

Evidence:

Evidence 1:



path: src/core/agent-harness/readiness-node-probes.ts

line: 194

excerpt:



> if (matchAuthPattern(spec.readyPattern, status.output)) {

Evidence 2:



path: src/core/agent-harness/readiness-node-probes.ts

line: 200

excerpt:



> detail: status.output,

Evidence 3:



path: src/modules/codex-agent-harness/adapter.test.ts

line: 205

excerpt:



> Logged in using ChatGPT as operator@example.com; expiresAt=2026-07-09T00:00:00.000Z

Evidence 4:



path: src/modules/doctor/doctor-checks.ts

line: 466

excerpt:



> metadata: { presetReadiness: readiness },

Evidence 5:



path: src/modules/doctor/doctor-control-routes.ts

line: 32

excerpt:



> jsonResponse(res, 200, report);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
