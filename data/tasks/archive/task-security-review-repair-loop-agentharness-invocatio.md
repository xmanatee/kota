---
status: done
---

# Security review: Repair-loop AgentHarness invocations omit agentConfig.authorityConfigPath. For a native repair run under a custom machine authority configuration, the adapter therefore passes undefined to the sandbox, which protects only the default global authority directory and token. The custom scope-authority operator token remains readable by the native process and may also be writable when located under an allowed workspace root.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/workflow/repair-loop-agent-iteration.ts
claim:

> Repair-loop AgentHarness invocations omit agentConfig.authorityConfigPath. For a native repair run under a custom machine authority configuration, the adapter therefore passes undefined to the sandbox, which protects only the default global authority directory and token. The custom scope-authority operator token remains readable by the native process and may also be writable when located under an allowed workspace root.

## Desired Outcome

> Pass agentConfig.authorityConfigPath and the workflow scope identity into every repair harness invocation. Add a native repair regression using a non-default authority configuration and prove both its configuration directory and operator token are inaccessible, matching the primary agent-attempt boundary.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T22-34-27-866Z-security-review-nx0r95.

finding id: repair-native-harness-drops-authority-config-path
candidate id: auth-approval-boundary:src/core/workflow/repair-loop-agent-iteration.ts:143
verdict: confirmed
rationale:

> The primary agent-attempt options forward agentConfig.authorityConfigPath, but executeRepairAgentIteration does not. The workflow runner does not inject it later, so native repair adapters receive undefined and protect only the default authority locations. A custom authority token is consequently readable and, when located beneath a writable workspace root, writable by the repair process.

Evidence:

Evidence 1:

path: src/core/workflow/steps/step-executor-agent.ts

line: 83

excerpt:

> AgentStepConfig carries authorityConfigPath?: string.

Evidence 2:

path: src/core/workflow/repair-loop-agent-iteration.ts

line: 121

excerpt:

> The repair run options include prompt, model, cwd, policy-routed tool controls, autonomyMode, and harnessOverrides, but never authorityConfigPath.

Evidence 3:

path: src/modules/codex-agent-harness/adapter.ts

line: 236

excerpt:

> collectTextFromCodexCli receives authorityConfigPath: options.authorityConfigPath, which is undefined for the repair invocation.

Evidence 4:

path: src/core/agent-harness/machine-authority-sandbox.ts

line: 36

excerpt:

> const configPath = resolve(authorityConfigPath ?? getGlobalConfigPath());

Evidence 5:

path: src/core/daemon/scope-authority-operator-token.ts

line: 144

excerpt:

> When an authorityConfigPath is supplied, the protected operator token is resolved beside that specific configuration file.

Evidence 6:

path: src/core/agent-harness/machine-authority-sandbox.ts

line: 70

excerpt:

> The native macOS sandbox allows reads by default and denies file reads only for the tokenPaths derived from the selected authority path.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `executeRepairAgentIteration` now delegates to the same
  `buildAgentHarnessRunOptions` projection as the primary agent attempt, so
  custom authority paths and workflow scope identity cannot drift between the
  two invocation paths.
- The focused repair-loop fixture records the emitted options and asserts the
  custom authority path, workflow identity, scope id, and project id.
- A source-module runtime probe loaded the shared primary/repair option path,
  and a native sandbox probe completed `git status` from a linked worktree with
  read-only host Git metadata.
