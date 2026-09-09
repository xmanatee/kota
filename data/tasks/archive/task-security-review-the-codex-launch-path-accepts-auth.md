---
status: done
---
# Security review: The Codex launch path accepts authorityConfigPath but omits its protections from the generated tool permission profile. Selecting native-cli ownership skips the shared sandbox that protects the authority directory and operator-token paths. When those paths fall within an otherwise readable workspace or explicit host grant, native tools can read the operator credential; when the authority directory falls within a writable workspace, they can also modify machine authority configuration. This crosses the operator-to-agent authority boundary.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/agent-harness/native-cli-sandbox.ts
claim:

> The Codex launch path accepts authorityConfigPath but omits its protections from the generated tool permission profile. Selecting native-cli ownership skips the shared sandbox that protects the authority directory and operator-token paths. When those paths fall within an otherwise readable workspace or explicit host grant, native tools can read the operator credential; when the authority directory falls within a writable workspace, they can also modify machine authority configuration. This crosses the operator-to-agent authority boundary.

## Desired Outcome

> Project machine-authority protections into the shared runtime context before choosing the sandbox owner. Ensure the Codex permission profile denies operator-token access and prevents authority-directory mutation, including custom locations and resolved aliases, regardless of overlapping grants. Verify through the adapter's generated profile using synthetic authority paths. This finding rests on static data-flow inspection; no credential access or exploitation was attempted.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T04-17-38-118Z-security-review-xk6sni.

Confirmed by security-review workflow runs:

- 2026-09-09T04-17-38-118Z-security-review-xk6sni

finding id: codex-native-profile-omits-machine-authority-protection
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/adapter.ts:69
verdict: confirmed
rationale:

> Static data-flow inspection confirms the omission. cli-runner.ts:354 selects native-cli ownership while forwarding authorityConfigPath; native-cli-sandbox.ts:270 consequently bypasses buildMachineAuthoritySandboxLaunch, whose machine-authority-sandbox.ts:43-46 derives protected authority directories and token paths. The context assembled at native-cli-sandbox.ts:237-251 contains neither protection, and runtime-home.ts:50-62 projects those incomplete lists into the Codex permission profile. protected-scope-paths.ts:13-23 supplies no fallback authority-file denial. Thus an otherwise granted root containing the operator token permits reads, and a writable root containing the authority directory permits mutation. Exposure requires that overlap; this review does not establish exposure on the current host.

Evidence:

Evidence 1:



path: src/modules/codex-agent-harness/cli-runner.ts

line: 354

excerpt:



> machineAuthorityOwner: "native-cli",
>       authorityConfigPath: args.authorityConfigPath,
>       writableRoots: args.writableRoots,
>       readOnlyHostRoots: args.readOnlyHostRoots,

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 270

excerpt:



> const launch = options.machineAuthorityOwner === "native-cli"
>       ? {
>           ok: true as const,
>           command: launchExecutable,
>           args: [...launchArgs],
>         }
>       : buildMachineAuthoritySandboxLaunch(launchExecutable, launchArgs, {
>           cwd: options.cwd,
>           authorityConfigPath: options.authorityConfigPath,

Evidence 3:



path: src/core/agent-harness/machine-authority-sandbox.ts

line: 43

excerpt:



> const configPath = resolve(authorityConfigPath ?? getGlobalConfigPath());
>   return {
>     configDirectories: resolvePathIdentities(dirname(configPath), process.cwd()),
>     tokenPaths: scopeAuthorityOperatorTokenPaths(configPath),
>   };

Evidence 4:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 237

excerpt:



> const readProtectedPaths = [...new Set([
>       ...existingProtectedScopePaths(options.cwd),
>       ...(runAuthorization?.readProtectedPaths ?? []),
>       ...(resolve(options.cwd) === resolve(process.cwd())
>         ? []
>         : existingProtectedScopePaths(process.cwd())),
>     ])];

Evidence 5:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 245

excerpt:



> const writeProtectedPaths = [...new Set([
>       join(options.cwd, ".git"),
>       ...(runAuthorization?.writeProtectedRoots ?? []),
>       ...nativeCliGitMetadataRoots(options.cwd),
>       readProtectedRootMask,
>       protectedRuntimeRoot,
>     ])];

Evidence 6:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 50

excerpt:



> for (const path of context.readableRoots) access.set(path, "read");
>   for (const path of context.writableRoots) access.set(path, "write");
>   for (const path of context.writeProtectedPaths) access.set(path, "read");
>   for (const path of [...context.readProtectedPaths, runtimeHome]) {
>     access.set(path, "deny");
>   }


## Resolution

Machine-authority path resolution is shared by both sandbox owners. The native launch context now includes operator-token read denials and authority-directory write protection before selecting the owner. Directory and configuration-file aliases preserve both lexical and resolved directory protections. Codex profile generation narrows nested write grants so they cannot reopen protected directories, and token denials override overlapping grants. Write protection only narrows existing grants: external authority directories receive no new read access, while independently granted child files remain readable.

Verification:

- Five new adapter-generated profile cases failed before the fix and pass afterward. Synthetic default/custom authority paths cover workspace and explicit host grants, directory/file aliases, existing and missing token targets, environment-selected token aliases, and nested writable output roots. The real adapter, shared launcher, and profile generator run with only provider/network launch ports controlled (and a synthetic default config locator).
- Critic repair: two additional adapter-profile cases reproduced unauthorized directory read grants before the repair and passed afterward. Both default and custom external authority locations are checked with no grant and with an independent configuration-file grant; neither exposes the directory, secrets.json, or .env. Operator-token denials remain present. All paths are synthetic.
- Focused owner checks: configuration authority, runtime home, adapter launch, machine-authority sandbox, dependency authority, and runtime write boundaries passed (36 tests); one platform-specific case was skipped. These cover the changed propagation/precedence boundary and adjacent shared sandbox behavior.
- Production and test TypeScript checks passed; scoped Biome and diff-whitespace checks passed.
- Limitation: the existing live sandbox suite had five passing cases and one failure because this execution sandbox forbids binding a loopback listener (listen EPERM on 127.0.0.1). No live Codex tool execution or real credential access was attempted; the task's requested proof is the generated adapter profile.
