---
status: done
---
# Security review: A scope-controlled .codex/config.toml symlink can authorize reads of an external host configuration file. The configuration-root helper accepts the resolved target without checking independent runtime authorization, and the Codex adapter projects that target into its tool filesystem permissions. For targets compatible with CLI configuration loading and outside explicit denials, this can expose confidential configuration or embedded credentials beyond the approved workspace.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/native-cli-sandbox-roots.ts
claim:

> A scope-controlled .codex/config.toml symlink can authorize reads of an external host configuration file. The configuration-root helper accepts the resolved target without checking independent runtime authorization, and the Codex adapter projects that target into its tool filesystem permissions. For targets compatible with CLI configuration loading and outside explicit denials, this can expose confidential configuration or embedded credentials beyond the approved workspace.

## Desired Outcome

> Require configuration targets outside the canonical workspace to have independent runtime-owned read authorization. Scope-controlled symlinks must not create that authorization. Verify that an unauthorized external configuration target never enters the generated tool permission profile, while explicitly authorized shared configurations remain supported. This finding is based on static data-flow inspection; no exploitation was attempted.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T03-01-07-616Z-security-review-znuf8a.

Confirmed by security-review workflow runs:

- 2026-09-09T03-01-07-616Z-security-review-znuf8a

finding id: workspace-config-symlink-expands-native-read-authority
candidate id: tool-execution:src/core/agent-harness/native-cli-sandbox-roots.ts:1
verdict: confirmed
rationale:

> Static inspection confirms the authorization expansion. native-cli-sandbox-roots.ts:65-67 resolves configuration symlinks without checking workspace containment or independent authorization. codex-agent-harness/cli-runner.ts:361-363 supplies that result as readOnlyHostRoots; native-cli-sandbox.ts:232 and :303-308 propagate it into readableRoots; codex-agent-harness/runtime-home.ts:50 and :56-58 serialize it as an explicit read permission. Existing denials cover designated protected paths, not arbitrary external configuration targets. The finding holds for targets compatible with CLI startup and outside those denials. Require independent runtime authorization before granting external configuration targets read access.

Evidence:

Evidence 1:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 65

excerpt:



> .map((path) => join(cwd, path))
> .filter(existsSync)
> .map((path) => realpathSync.native(path)),

Evidence 2:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 361

excerpt:



> readOnlyHostRoots: nativeCliWorkspaceConfigurationReadRoots(args.cwd, [
>   ".codex/config.toml",
> ]),

Evidence 3:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 232

excerpt:



> ...(options.readOnlyHostRoots ?? []),

Evidence 4:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 50

excerpt:



> for (const path of context.readableRoots) access.set(path, "read");

## Resolution

Removed the workspace-configuration root helper and its Codex adapter call. Configuration discovery no longer resolves scope-controlled links into new host read grants. Configurations within the canonical workspace retain workspace access. The runtime can independently authorize external shared configurations through readOnlyHostRoots in harness run options; the Codex adapter carries those grants through collectTextFromCodexCli to the shared sandbox and generated permission profile. Omission adds no host grant. Updated the Codex harness instructions and replaced the test that endorsed automatic link authorization.

## Verification

- The new owner-boundary regression reproduced the old behavior for both a linked config.toml and a linked .codex directory: the generated tool permission profile included the unauthorized external target. Both cases pass after removal, with no grant for the target or its ancestors.
- Explicit runtime file and directory grants reach the generated Codex permission profile as read-only permissions. Both positive and negative cases enter through codexAgentHarness.run and exercise the production CLI launcher, sandbox root projection, and runtime-home generation; only provider launch and network ports are controlled.
- pnpm test:owner src/modules/codex-agent-harness src/core/agent-harness/native-cli-sandbox-roots.test.ts src/core/agent-harness/native-cli-dependency-authority.test.ts: 42 tests passed across 8 files.
- pnpm typecheck: production and test projects passed. Scoped Biome checks passed for all seven changed TypeScript files.
- Static inspection confirms that the deleted helper had only the removed Codex production caller; existing explicit runtime grants and denials are unchanged.

The generated permission profile is the oracle for this grant-expansion defect. No live provider invocation or host-secret read was attempted; actual Codex CLI sandbox enforcement was not re-probed.
