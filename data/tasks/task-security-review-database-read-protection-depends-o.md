---
status: blocked
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

## Blocked on

kind: operator-capture
path: .kota/runs
description: Task-attributable availability of authorized Linux confinement execution, or equivalent executed synthetic boundary evidence.

The existing evidence-review kind records execution authority. Its path is a
discovery hint, not a required capture location. Reopen when scoped capability
evidence establishes an authorized invocation; running and assessing the tests
remains this task's work.

An authorized execution path from this retained run to a Linux environment that
can launch the production bubblewrap boundary against synthetic data, or an
attributable export of that execution. This is an execution-authority limitation
of the current worker, not a claim that the host lacks Docker. No particular
capture directory or manual operator execution is required.

Repair assessment on 2026-09-12, run
`2026-09-12T06-41-37-210Z-builder-kuqngk`, checked the available setup paths:

- The worker runs on Darwin. Docker is installed at `/usr/local/bin/docker`;
  `docker version --format '{{json .Server}}'` exited 1 with permission denied
  connecting to `unix:///var/run/docker.sock`. No server version was returned.
  `bwrap`, `podman`, `limactl` and `qemu-system-aarch64` were not discoverable
  on the worker PATH.
- Repository dependencies are usable. The existing synthetic non-writer and
  absent-state tests reached the production native launcher, then explicitly
  skipped because the enclosing sandbox forbids nested OS sandbox execution.
  This is no confinement pass and does not alone justify this blocker.
- `pnpm kota eval --help` succeeded. Its current surface offers fixture runs,
  calibration, fixture discovery and AGY model evaluation. Inspection of
  `src/modules/eval-harness/client.ts` and `index.ts` found fixture/model run
  contracts, not a worker-callable command for these deterministic Linux tests.
  The native request/reply owner in
  `src/core/workflow/native-run-authorization.ts` returns only a boolean writer
  authorization challenge; its writable request directory is not a host
  execution service. No contained-execution tool is exposed to this invocation.
- The supplied `issue-evidence.json` contains the original security reviews and
  published writer `1743ee4d323e646d2ececcac7cd84650878a53d4`, without a new
  task-linked Linux execution export. The open contained-evaluation task is
  relevant enabling work, but its fixture/model scope is not itself proof that
  this deterministic confinement probe can execute.

Available local setup and discovery therefore reach an unavailable authority:
this worker cannot dispatch a Linux child through an exposed trusted runtime
capability. Installing dependencies or changing test commands cannot grant that
authority. No Docker socket, raw daemon data, credentials, or weakened launcher
was supplied to candidate code; the parent daemon was not controlled.

Resume when the runtime exposes scoped execution for these synthetic checks or
equivalent attributable results become available. Run the existing database,
late-journal and absent-state cases and verify both denied private reads and
successful repository reads/persisted artifact writes. Repair any observed
confinement defect before marking this finding done.

## Verification of this disposition

No production code or tests were changed in this run. The prior handoff-only
return did not satisfy builder completion; this blocked disposition replaces it.
The existing published implementation remains subject to the unfulfilled Linux
execution contract above.

- `pnpm test:owner src/core/agent-harness/native-cli-sandbox.test.ts -t
  'non-writer|without a state directory' --reporter=verbose`: two policy checks
  passed for canonical/custom-linked live database locators. Two selected
  confinement checks skipped at sandbox bootstrap; nine other tests were
  excluded by selection. This distinguishes missing locator propagation, not
  successful OS confinement.
- `pnpm test:owner src/core/agent-harness/machine-authority-sandbox.test.ts
  src/core/agent-harness/native-cli-sandbox-roots.test.ts --reporter=verbose`:
  16 passed, two Linux-only cases skipped on Darwin. These checks cover mount
  policy construction, effective restriction preservation, absent paths and
  intended runtime/dependency roots; they do not establish Linux execution.



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
