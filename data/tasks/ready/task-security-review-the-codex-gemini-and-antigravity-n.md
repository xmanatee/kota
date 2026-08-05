---
id: task-security-review-the-codex-gemini-and-antigravity-n
title: Security review: The Codex, Gemini, and Antigravity native adapters now advertise scope-policy support, but compile only local-write restrictions. Policies denying network effects, disabling modules, or requiring confirmation for other effects are accepted without enforcement or fail-closed rejection, while the unrestricted native tool loop and provider egress still launch.
status: ready
priority: p1
area: security
task_class: Safety
summary: The Codex, Gemini, and Antigravity native adapters now advertise scope-policy support, but compile only local-write restrictions. Policies denying network effects, disabling modules, or requiring confirmation for other effects are accepted without enforcement or fail-closed rejection, while the unrestricted native tool loop and provider egress still launch.
created_at: 2026-08-05T10:55:52.585Z
updated_at: 2026-08-05T10:55:52.585Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/native-cli-scope-policy.ts
claim:

> The Codex, Gemini, and Antigravity native adapters now advertise scope-policy support, but compile only local-write restrictions. Policies denying network effects, disabling modules, or requiring confirmation for other effects are accepted without enforcement or fail-closed rejection, while the unrestricted native tool loop and provider egress still launch.

## Desired Outcome

> Define the policy dimensions each native adapter can enforce and reject launches when the effective policy requires anything else. Disable native network-capable tools when network effects are denied, or prove their effects cannot traverse provider transport. Add tests against the real shipped adapters using network-denied and module-disabled policies; the generic fixture that declares scopePolicy unsupported does not cover these adapters.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-05T09-30-01-005Z-security-review-m3c8bg.

finding id: native-scope-policy-only-projects-writes
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/adapter.ts:146
verdict: confirmed
rationale:

> The native policy compiler evaluates only autonomyMode, ownerConfirmation.localWrite, and writes (src/core/agent-harness/native-cli-scope-policy.ts:14). The shipped adapters nevertheless accept scopePolicy and pass it only to this helper, while native tools bypass KOTA's per-call policy gate and provider egress remains enabled (src/modules/codex-agent-harness/adapter.ts:205, src/modules/codex-agent-harness/cli-runner.ts:354). Module availability, externalEffects, externalWrite, and destructive confirmation restrictions therefore neither constrain execution nor reject launch.

Evidence:

Evidence 1:



path: src/core/agent-harness/native-cli-scope-policy.ts

line: 14

excerpt:



> nativeCliWritableRoots examines passive mode, ownerConfirmation.localWrite, and policy.writes only; it never evaluates externalEffects, modules, externalWrite, or destructive confirmation policy.

Evidence 2:



path: src/modules/codex-agent-harness/adapter.ts

line: 205

excerpt:



> The adapter declares toolControl: "native", omits scopePolicy from unsupportedRunOptions, and passes the policy only to nativeCliWritableRoots when constructing writableRoots.

Evidence 3:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 322

excerpt:



> Codex still launches with --dangerously-bypass-approvals-and-sandbox and approval_policy="never".

Evidence 4:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 346

excerpt:



> Every launch supplies CODEX_PROVIDER_EGRESS_HOSTS to withNativeCliSandbox regardless of the policy's externalEffects settings.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
