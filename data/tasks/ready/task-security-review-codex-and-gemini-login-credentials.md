---
id: task-security-review-codex-and-gemini-login-credentials
title: Security review: Codex and Gemini login credentials are copied into the same invocation root that the unrestricted native tool process may read and write. Because Codex runs its tool loop with approvals and its internal sandbox bypassed, an injected instruction can direct a shell tool to read auth.json and place the ChatGPT credential in model-visible tool output or workflow artifacts.
status: ready
priority: p1
area: security
task_class: Safety
summary: Codex and Gemini login credentials are copied into the same invocation root that the unrestricted native tool process may read and write. Because Codex runs its tool loop with approvals and its internal sandbox bypassed, an injected instruction can direct a shell tool to read auth.json and place the ChatGPT credential in model-visible tool output or workflow artifacts.
created_at: 2026-08-05T10:55:52.597Z
updated_at: 2026-08-05T10:55:52.597Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/runtime-home.ts
claim:

> Codex and Gemini login credentials are copied into the same invocation root that the unrestricted native tool process may read and write. Because Codex runs its tool loop with approvals and its internal sandbox bypassed, an injected instruction can direct a shell tool to read auth.json and place the ChatGPT credential in model-visible tool output or workflow artifacts.

## Desired Outcome

> Separate provider authentication from the tool-execution sandbox, for example through a host-owned authenticated transport or a privileged launcher that does not expose credential files to native tool subprocesses. Add a regression proving native shell tools cannot read or overwrite provider login material while the CLI can still authenticate.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-05T09-30-01-005Z-security-review-m3c8bg.

finding id: native-cli-provider-login-readable-by-agent-tools
candidate id: tool-execution:src/modules/codex-agent-harness/adapter.ts:41
verdict: confirmed
rationale:

> Codex copies auth.json beneath the invocation directory (src/modules/codex-agent-harness/runtime-home.ts:16), and Gemini copies oauth_creds.json and google_accounts.json there (src/modules/gemini-cli-agent-harness/runtime-home.ts:63). That entire directory is included in the sandbox's readable and writable roots (src/core/agent-harness/native-cli-sandbox.ts:153, src/core/agent-harness/native-cli-sandbox.ts:175). Codex then launches its native tool loop with its internal approvals and sandbox bypassed (src/modules/codex-agent-harness/cli-runner.ts:324), so child tools share direct filesystem access to the copied credential.

Evidence:

Evidence 1:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 16

excerpt:



> prepareCodexRuntimeEnvironment copies the host CODEX_HOME/auth.json into <temporaryDirectory>/codex-home/auth.json and exports that directory as CODEX_HOME.

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 153

excerpt:



> The temporary directory is included in nativeCliReadableRoots, and line 175 also appends it to writableRoots for the sandboxed process.

Evidence 3:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 322

excerpt:



> The same credential-bearing process launches Codex with --dangerously-bypass-approvals-and-sandbox and approval_policy="never", leaving native command tools without a separate credential boundary.

Evidence 4:



path: src/modules/gemini-cli-agent-harness/runtime-home.ts

line: 63

excerpt:



> Gemini similarly copies oauth_creds.json and google_accounts.json into the invocation home that is exposed to its native tool process.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
