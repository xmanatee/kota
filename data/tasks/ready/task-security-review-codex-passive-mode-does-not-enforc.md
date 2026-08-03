---
id: task-security-review-codex-passive-mode-does-not-enforc
title: Security review: Codex passive mode does not enforce KOTA's passive-session contract. It changes only filesystem write roots while launching the full native tool runtime with Codex approvals and sandboxing bypassed. Because the outer sandbox leaves process execution and network access enabled and KOTA tool gates are unavailable, a passive Codex run can perform external side effects without denial or operator approval.
status: ready
priority: p1
area: security
task_class: Safety
summary: Codex passive mode does not enforce KOTA's passive-session contract. It changes only filesystem write roots while launching the full native tool runtime with Codex approvals and sandboxing bypassed. Because the outer sandbox leaves process execution and network access enabled and KOTA tool gates are unavailable, a passive Codex run can perform external side effects without denial or operator approval.
created_at: 2026-08-03T20:38:28.354Z
updated_at: 2026-08-03T20:38:28.354Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/adapter.ts
claim:

> Codex passive mode does not enforce KOTA's passive-session contract. It changes only filesystem write roots while launching the full native tool runtime with Codex approvals and sandboxing bypassed. Because the outer sandbox leaves process execution and network access enabled and KOTA tool gates are unavailable, a passive Codex run can perform external side effects without denial or operator approval.

## Desired Outcome

> Reject passive mode for the Codex native harness until every non-safe native tool effect can be denied. Alternatively, enforce a genuinely read-only native tool catalog plus network mediation that permits only provider transport, remove the approvals-bypass posture for passive runs, and add boundary tests covering shell execution, outbound GET/POST requests, and native MCP/tool calls.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T18-46-02-385Z-security-review-0pumcq.

finding id: security-review-codex-passive-mode-allows-external-effects
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/adapter.ts:156
verdict: confirmed
rationale:

> Passive mode changes only the native sandbox's writable roots. Codex still launches with approvals and its internal sandbox bypassed, approval_policy set to never, and no KOTA canUseTool gate. The macOS profile starts from allow default, while the Linux bubblewrap invocation retains process execution and the host network namespace. A passive run can therefore execute commands and perform outbound side effects despite the passive contract requiring denial of non-safe tool calls.

Evidence:

Evidence 1:



path: src/core/tools/autonomy-mode.ts

line: 11

excerpt:



> `passive` — read-only. Any non-safe tool call is denied outright.

Evidence 2:



path: src/modules/codex-agent-harness/adapter.ts

line: 141

excerpt:



> The adapter rejects canUseTool because Codex CLI tool calls cannot be routed through KOTA's gate.

Evidence 3:



path: src/modules/codex-agent-harness/adapter.ts

line: 194

excerpt:



> return options.autonomyMode === "passive" ? "read-only" : "workspace-write";

Evidence 4:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 309

excerpt:



> "--dangerously-bypass-approvals-and-sandbox",

Evidence 5:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 328

excerpt:



> 'approval_policy="never"',

Evidence 6:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 69

excerpt:



> The macOS profile starts with (allow default) and restricts file access only; the Linux launch does not create a separate network namespace.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
