---
status: open
priority: p1
---
# Security review: The generated Codex permission profile protects the copied runtime credentials but omits the original login auth.json. When the original CODEX_HOME falls within the workspace or an independently granted host root, native agent tools retain read access to the provider credential, crossing the provider-to-agent credential boundary. This finding is based on static data-flow inspection; current-host exposure was not established.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/runtime-home.ts
claim:

> The generated Codex permission profile protects the copied runtime credentials but omits the original login auth.json. When the original CODEX_HOME falls within the workspace or an independently granted host root, native agent tools retain read access to the provider credential, crossing the provider-to-agent credential boundary. This finding is based on static data-flow inspection; current-host exposure was not established.

## Desired Outcome

> Deny native-tool access to the original login credential as well as its runtime copy, preserving lexical and resolved path identities and denial precedence over overlapping grants. Verify generated adapter profiles with synthetic login files inside workspace and host grants, including symlink aliases. No real credential access or exploitation is needed.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T05-45-21-013Z-security-review-5bo0ks.

Confirmed by security-review workflow runs:

- 2026-09-09T05-45-21-013Z-security-review-5bo0ks

finding id: codex-source-login-credential-not-protected
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/runtime-home.ts:62
verdict: confirmed
rationale:

> Static inspection confirms the conditional exposure. runtime-home.ts:30-40 copies the original auth.json but passes only runtimeHome to profile generation. Lines 51-64 preserve workspace/host grants and deny only context.readProtectedPaths plus runtimeHome. native-cli-sandbox.ts:232-245 propagates independent host grants without adding the source credential to protected paths; protected-scope-paths.ts:13-23 likewise excludes auth.json. cli-runner.ts:354 selects native-cli authority, whose launch branch at native-cli-sandbox.ts:273-278 adds no outer KOTA sandbox. Consequently, an original login credential inside an otherwise readable root remains unprotected unless another denial independently covers it. No credentials were accessed, and current-host exposure or exploitation was not established.

Evidence:

Evidence 1:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 30

excerpt:



> const sourceAuthPath = join(resolveCodexHome(env), "auth.json");
> const runtimeHome = join(context.invocationRoot, "codex-home");
> mkdirSync(runtimeHome, { mode: 0o700 });
> if (existsSync(sourceAuthPath)) {
>   const destination = join(runtimeHome, "auth.json");
>   copyFileSync(sourceAuthPath, destination);

Evidence 2:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 38

excerpt:



> writeFileSync(
>   join(runtimeHome, "config.toml"),
>   codexPermissionProfile(context, runtimeHome),
>   { mode: 0o600 },
> );

Evidence 3:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 51

excerpt:



> for (const path of context.readableRoots) access.set(path, "read");
> for (const path of context.writableRoots) access.set(path, "write");

Evidence 4:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 58

excerpt:



> for (const path of [...context.readProtectedPaths, runtimeHome]) {
>   access.set(path, "deny");
> }

Evidence 5:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 354

excerpt:



> machineAuthorityOwner: "native-cli",
> authorityConfigPath: args.authorityConfigPath,
> writableRoots: args.writableRoots,
> readOnlyHostRoots: args.readOnlyHostRoots,
> env: buildCodexEnvironment(args.env),
> allowedEgressHosts: CODEX_PROVIDER_EGRESS_HOSTS,
> prepareEnvironment: prepareCodexRuntimeEnvironment,
