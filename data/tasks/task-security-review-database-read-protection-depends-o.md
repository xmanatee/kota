---
status: open
priority: p2
---
# Security review: Database read protection depends on writer authorization. A native CLI invocation without writer identity, running from the daemon's canonical repository, receives repository-wide read access without denials for kota.sqlite or its journals. On a multi-scope daemon, this exposes other scopes' persisted workflow data. The writer fix therefore leaves a non-writer cross-scope confidentiality gap.

## Current Contract

Reopened for supported Linux validation setup and any resulting confinement repair.
The 720nnv writer published `1743ee4d3` and released its resources/sandbox; static
and policy-construction checks are not an executed security pass. Exercise the
non-writer database, late-journal and absent-state boundaries with synthetic data,
preserving intended repository reads and artifact writes. Use an authorized Linux
bubblewrap context or equivalent attributable boundary proof, not raw host data or
a weakened launcher. A denied nested probe alone does not establish impossibility;
only a specific unavailable execution authority after setup is exhausted warrants
a block. The confidentiality finding remains unclosed until its guarantee is proven.

security family: 0d08d683e9a7787d3a4e0da83efee038bb24506b96c6a42898dea41b55935c86

This contract supersedes historical blocking and operational-capture requirements.



## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/agent-harness/native-cli-sandbox.ts
claim:

> Database read protection depends on writer authorization. A native CLI invocation without writer identity, running from the daemon's canonical repository, receives repository-wide read access without denials for kota.sqlite or its journals. On a multi-scope daemon, this exposes other scopes' persisted workflow data. The writer fix therefore leaves a non-writer cross-scope confidentiality gap.

## Desired Outcome

> Apply daemon database and journal read denials independently of writer authorization, using a trusted runtime locator for every native invocation. Verify that a non-writer launch from the canonical repository cannot read unrelated scopes' database records while retaining intended repository access. This finding is based on static data-flow inspection; no database access or exploitation was attempted.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-07T20-18-07-241Z-security-review-9qgl1k.

Confirmed by security-review workflow runs:

- 2026-09-07T20-18-07-241Z-security-review-9qgl1k

finding id: native-nonwriter-database-read
candidate id: secret-handling:src/core/agent-harness/native-cli-sandbox.ts:70
verdict: confirmed
rationale:

> Static inspection confirms the conditional confidentiality gap. src/core/workflow/run-resources.ts:86 supplies database location and authorization identity only to writers. src/core/workflow/native-run-authorization.ts:69 returns undefined without that identity; database and journal denials are constructed only at line 132. src/core/agent-harness/native-cli-sandbox.ts:237 consequently omits those denials for non-writers, while native-cli-sandbox-roots.ts:157 grants cwd read access. The generic protections in src/core/tools/protected-scope-paths.ts:13 exclude SQLite files. The Codex launch at src/modules/codex-agent-harness/cli-runner.ts:351 adds no independent database denial, and runtime-home.ts:50 propagates these permissions. When the shared daemon database lies beneath the invocation's readable canonical repository, its records therefore remain readable. src/core/daemon/daemon-context-factory.ts:86 registers all scopes in one database, whose schema stores scope-tagged triggers and state at src/core/workflow/run-state-schema.ts:163 and :251. Database read protection must apply independently of writer authorization.

Evidence:

Evidence 1:



path: src/core/workflow/native-run-authorization.ts

line: 69

excerpt:



> const identity = runIdentity(workspace, env);
> if (identity === null) {
>   if (env.KOTA_RUN_STATE_DIR || env.KOTA_RUN_AUTHORIZATION) throw new Error(DENIED);
>   return undefined;
> }

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 237

excerpt:



> const readProtectedPaths = [...new Set([
>   ...existingProtectedScopePaths(options.cwd),
>   ...(runAuthorization?.readProtectedPaths ?? []),

Evidence 3:



path: src/core/tools/protected-scope-paths.ts

line: 14

excerpt:



> export const PROTECTED_SCOPE_RUNTIME_FILES = [
>   ".kota/daemon-control.json",
>   ".kota/secrets.json",
> ] as const;

Evidence 4:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 155

excerpt:



> return [...new Set([
>   ...platformRoots.filter(existsSync),
>   cwd,
>   invocationRoot,

Evidence 5:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 50

excerpt:



> for (const path of context.readableRoots) access.set(path, "read");
> for (const path of context.writableRoots) access.set(path, "write");
> for (const path of context.writeProtectedPaths) access.set(path, "read");
> for (const path of [...context.readProtectedPaths, runtimeHome]) {
>   access.set(path, "deny");
> }

Evidence 6:



path: src/core/daemon/daemon-context-factory.ts

line: 86

excerpt:



> runState = new RunStateDatabase(stateDir);
> for (const scope of scopeRegistry.list()) {
>   runState.registerScope({
>     id: scope.scopeId,
>     rootPath: scope.scopeRoot,



## Repair and final verification

The retained proposed fix derives database and SQLite sidecar denials from
host-owned open database locators independently of writer authorization,
including canonical, custom, and symlink state locations. Linux projects
database directories into private namespace mounts, masks denied entries, and
restores permitted existing entries and narrower write grants. Absent state
directories beneath read-only binds receive an existing-ancestor projection.

Reassessment on 2026-09-10 used the retained patch without changing production
code or tests. Repository dependencies are now available. Production and test
TypeScript checks both passed, as did Biome on all six changed TypeScript files.
The focused machine-authority and native CLI suites reported 11 passed,
2 skipped, and 1 failed. Passing cases establish non-writer locator propagation
for canonical and custom-linked storage, connection lifetime handling, and
Linux policy construction. Both new child confinement cases skipped because
the enclosing sandbox denied nested OS sandbox launch. The existing mediated
network case failed at listener setup with EPERM on 127.0.0.1.

The database owner suite reported 34 passed and 1 failed. The failure is an
unchanged migration assertion expecting schema version 5 while the unchanged
schema migrates to version 6; inspection of HEAD confirms the stale assertion.
This check does not establish OS confinement. Production task validation passed
with zero errors and warnings, and scoped diff whitespace validation passed.

Docker API access at /var/run/docker.sock is denied from this invocation;
that does not establish whether a host engine exists. The collected issue
evidence contains the original security review and historical runtime evidence,
without a successful confinement execution for this patch. No raw host database
was read, and no sandbox or authorization boundary was bypassed.

The original security finding remains unclosed. Static checks and compiler
tests support the retained implementation, but they cannot establish that the
Linux mount sequence launches successfully and preserves intended access.
Required remaining proof is successful execution of the existing non-writer
database/late-journal and absent-state boundary regressions, including repository
reads and persisted artifact writes, on a permitted Linux bubblewrap runtime.

Post-check repair on 2026-09-10 corrected the critic's retained mount-policy
defect: Linux projections now discard earlier bindings hidden by later binds
at the same target or an ancestor before restoring descendant mounts. This
preserves effective authority and write restrictions instead of reopening an
overridden writable child. Three public sandbox-builder regressions reproduced
the defect before the fix and passed afterward, covering authority directories,
protected paths, and write boundaries while retaining permitted artifact mounts.
The focused machine-authority, native CLI, and sandbox-root suites reported
18 passed, 2 skipped for unavailable nested sandbox execution, and the existing
listener-setup failure with EPERM on 127.0.0.1. Production and test typechecks,
Biome for both repaired TypeScript files, task validation, and scoped diff
whitespace validation passed. This compiler-boundary proof resolves the reported replay
defect; the executed Linux confinement requirement below remains outstanding.

## Additional confirmed evidence


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/agent-harness/native-cli-sandbox.ts
claim:

> The existing non-writer confidentiality gap remains present. Database read denials are supplied only by writer authorization, which returns undefined without a writer identity. Native launches still receive repository read access, allowing an influenced non-writer agent to read other scopes' persisted workflow data when the shared database lies beneath that repository.

## Desired Outcome

> Resolve the daemon database location from trusted runtime context for every native invocation and deny reads of the database and all SQLite sidecars independently of writer authorization. This closes each variant because the shared sandbox supplies the denials to every native permission owner.

> Retain the existing open repair task and its earlier evidence. Verify the repair with a non-writer invocation against a synthetic multi-scope database, including SQLite sidecars, while preserving intended repository reads. This is unchanged evidence, not a demonstrated reintroduction.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T22-54-43-700Z-security-review-nrrakv.

Confirmed by security-review workflow runs:

- 2026-09-09T22-54-43-700Z-security-review-nrrakv

security evidence: a4c688747951699c284b5dfafc83f6ff3daf66d5b52b9599e1a3b16b6598c3a8
evidence identity: native-nonwriter-database-read
production owner: core/agent-harness/native-cli-sandbox
violated invariant: daemon-database-read-isolation
Common repair:
> Resolve the daemon database location from trusted runtime context for every native invocation and deny reads of the database and all SQLite sidecars independently of writer authorization. This closes each variant because the shared sandbox supplies the denials to every native permission owner.
Exploit preconditions:
> An attacker influences a native agent's commands, for example through repository content or prompt injection. The invocation has no writer identity, its readable repository contains the daemon database, and that database holds information from other scopes. Static inspection confirms the conditional permission gap; no protected database was accessed and no native exploit was executed.
finding id: native-nonwriter-database-read
candidate id: auth-approval-boundary:src/core/agent-harness/native-cli-sandbox.ts:6
verdict: confirmed
rationale:

> Confirmed by static inspection at e16275b484ea81cf015dc5192d5e0ab4e384eef2. native-run-authorization.ts:70 returns undefined without writer identity; database and SQLite sidecar denials are constructed only in its writer branch at lines 132–139. native-cli-sandbox.ts:238 consequently omits those denials, while native-cli-sandbox-roots.ts:150 grants repository reads. Generic protected paths exclude SQLite files, and Codex runtime-home.ts:58 propagates repository access without an independent database denial. CLI invocations can use the canonical repository without writer identity (src/cli.ts:473–478). When that readable repository contains the shared daemon database, attacker-influenced commands can access other scopes' persisted triggers and state; daemon-context-factory.ts:86 and run-state-schema.ts establish shared storage. This does not imply every non-writer invocation is exposed: detached worktrees need the database independently within their readable roots. The existing open task matches the production owner, invariant and common repair: supply trusted database and sidecar denials independently of writer authorization. Evidence is unchanged, not a demonstrated reintroduction.

Evidence:

Evidence 1:



path: src/core/workflow/native-run-authorization.ts

line: 70

excerpt:



> if (identity === null) {
>     if (env.KOTA_RUN_STATE_DIR || env.KOTA_RUN_AUTHORIZATION) throw new Error(DENIED);
>     return undefined;
>   }

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 238

excerpt:



> const readProtectedPaths = [...new Set([
>       ...tokenPaths,
>       ...existingProtectedScopePaths(options.cwd),
>       ...(runAuthorization?.readProtectedPaths ?? []),

Evidence 3:



path: src/core/tools/protected-scope-paths.ts

line: 13

excerpt:



> export const PROTECTED_SCOPE_RUNTIME_FILES = [
>   ".kota/daemon-control.json",
>   ".kota/secrets.json",
> ] as const;

Evidence 4:



path: src/core/agent-harness/native-cli-sandbox-roots.ts

line: 150

excerpt:



> return [...new Set([
>     ...platformRoots.filter(existsSync),
>     cwd,
>     invocationRoot,

Evidence 5:



path: src/modules/codex-agent-harness/runtime-home.ts

line: 58

excerpt:



> for (const path of context.readableRoots) access.set(path, "read");
