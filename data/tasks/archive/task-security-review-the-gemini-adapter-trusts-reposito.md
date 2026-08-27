---
status: done
---

# Security review: The Gemini adapter trusts repository-controlled workspace configuration while retaining Gemini-native MCP configuration. A malicious `.gemini/settings.json` can register a process-backed MCP server that runs inside the same outer sandbox as Gemini's copied OAuth state. Because the invocation root containing those credentials is readable and writable to that sandbox, the project process can read provider login material and expose it through MCP output or workspace artifacts, bypassing KOTA's tool gate and Gemini's model-tool sandbox.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/gemini-cli-agent-harness/cli-runner.ts
claim:

> The Gemini adapter trusts repository-controlled workspace configuration while retaining Gemini-native MCP configuration. A malicious `.gemini/settings.json` can register a process-backed MCP server that runs inside the same outer sandbox as Gemini's copied OAuth state. Because the invocation root containing those credentials is readable and writable to that sandbox, the project process can read provider login material and expose it through MCP output or workspace artifacts, bypassing KOTA's tool gate and Gemini's model-tool sandbox.

## Desired Outcome

> Use a sanitized Gemini invocation configuration that disables repository-provided MCP servers, hooks, extensions, discovery commands, and other executable workspace configuration instead of trusting `.gemini/settings.json`. Keep provider authentication behind a boundary that Gemini-spawned children cannot inherit, and add a hostile workspace-settings regression proving an MCP server cannot start or read copied authentication material in passive or autonomous mode.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Completion

Repository `.gemini/` and `.agents/` roots are now hidden from Gemini's native
process tree, KOTA-owned protected settings disable executable Gemini
configuration, and credential-bearing launches fail before Gemini or a
repository-controlled process can start. Authenticated native runs remain
disabled until provider authentication can be brokered outside the native tool
tree.

Verification:

- `pnpm typecheck`
- `pnpm test src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/runtime-home.test.ts src/modules/gemini-cli-agent-harness/auth-readiness.test.ts src/modules/execution/machine-authority-sandbox.test.ts` (31 tests passed)
- `pnpm test src/core/agent-harness/native-cli-sandbox.test.ts -t "hides executable workspace configuration roots"` (1 focused test passed)
- `pnpm validate-tasks`

Run evidence: `.kota/runs/2026-08-05T16-51-51-837Z-builder-8deezh/evidence/artifacts/verification.txt`.

## Source / Intent

Created by security-review workflow run 2026-08-05T13-21-35-351Z-security-review-1h3xsj.

finding id: gemini-workspace-config-can-access-provider-auth
candidate id: auth-approval-boundary:src/modules/gemini-cli-agent-harness/cli-runner.ts:218
verdict: confirmed
rationale:

> KOTA passes `--skip-trust` and explicitly exposes `.gemini/settings.json`, so Gemini CLI 0.46.0 merges repository MCP configuration and starts configured stdio servers during headless initialization. Those child processes inherit `GEMINI_CLI_HOME`, which points to the invocation-root directory containing copied OAuth credentials. KOTA makes that invocation root readable and writable, while Gemini's default macOS sandbox permits child execution and access to its home. The MCP process can therefore read provider login material outside KOTA's tool authorization boundary.

Evidence:

Evidence 1:

path: src/modules/gemini-cli-agent-harness/cli-runner.ts

line: 210

excerpt:

> The launch passes `--sandbox` followed by `--skip-trust`, which trusts the current workspace for this headless session.

Evidence 2:

path: src/modules/gemini-cli-agent-harness/cli-runner.ts

line: 241

excerpt:

> The sandbox explicitly exposes the workspace `.gemini/settings.json` as configuration input through `nativeCliWorkspaceConfigurationReadRoots`.

Evidence 3:

path: src/modules/gemini-cli-agent-harness/adapter.ts

line: 38

excerpt:

> The adapter rejects only KOTA-supplied MCP configuration on the basis that `Gemini CLI owns its own MCP configuration`, leaving workspace-native MCP configuration active.

Evidence 4:

path: src/modules/gemini-cli-agent-harness/runtime-home.ts

line: 68

excerpt:

> Gemini's provider home is created under `context.invocationRoot`, and `oauth_creds.json` plus `google_accounts.json` are copied into it.

Evidence 5:

path: src/core/agent-harness/native-cli-sandbox.ts

line: 180

excerpt:

> `nativeCliReadableRoots` receives the whole `temporaryDirectory`, making the invocation root recursively readable to the outer native process sandbox.

Evidence 6:

path: src/core/agent-harness/native-cli-sandbox.ts

line: 215

excerpt:

> The KOTA-owned machine sandbox also appends the entire `temporaryDirectory` to its writable roots.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
