---
status: blocked
priority: p2
depends_on: [task-run-contained-linux-runtime-probes]
---
# Security review: Browser profile persistence checks filesystem authority separately from the write. When persistProfile is enabled, a concurrent writer able to replace the profile file or an ancestor directory can redirect the path after validation but before Playwright writes it. This can write authenticated browser state outside the agent's declared write roots with the host process's permissions. The canonical-path recheck does not make the subsequent pathname-based write atomic.

## Current Contract

Reopened for the missing secure persistence implementation and supported contained
setup. The prior un8vlq writer published `00588eaa6` and released its resources
and sandbox; there is no retained task claim to adopt. Keep fail-closed containment
until the owning write primitive proves successful private publication and denial
under root/staging relocation with unchanged outside sentinels. A directory handle
or repeated pathname check is still insufficient. Historical Darwin/nested-sandbox
denials are context limits, not grounds to defer implementation or invent missing
credentials. Escalate only a specific unavailable execution authority after useful
setup is exhausted; never restore the defeated writer merely to claim persistence.

This contract supersedes historical blocking and operational-capture requirements.

## Implementation Prerequisite

The host has now demonstrated working Linux Bubblewrap confinement with synthetic
data; the exported native-launcher result is under
`.kota/runs/monitor-2026-09-12T11-03-45Z/native-sandbox-linux-corrected.json`.
The native-probe dependency is now archived as `done`. Its shared native tool
mediation and task-probe/container owners are present, and this run successfully
reached the host through that mediation. The prior continuation's dependency-wait
rationale is stale; the concrete host grant failure below is the current obstacle.

Once the scoped execution grant is active, implement the missing credential writer
and test successful private persistence plus relocation/symlink rejection. The prior
fail-closed mitigation is not feature completion. Do not weaken it, restore the
defeated writer, or demand an additional operator-readiness artifact before work
can resume. The host monitor handles deployment follow-up after publication.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Host lifecycle owner activates an offline native-probe grant for this scope; normal native inspect/probe results or equivalent attributable host evidence permit resumption, with no separate readiness capture required.

The invoking host has no `KOTA_EVAL_CONTAINED_PROFILES` configuration. In builder
run `2026-09-12T17-27-13-592Z-builder-nzwt51`, the maintained command
`pnpm kota eval contained '{"operation":"inspect"}'` reached the host and returned
`Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`
(`tool-8def45d4c8d2510c3085637ef57042ae`). This is an observed missing execution
grant, not an inference from the worker sandbox, missing credentials, or a claim
that Docker/Linux is unavailable.

The host lifecycle owner must activate an offline deterministic probe profile for
this canonical scope, selecting a reviewed image through the existing contained
evaluation setup. The builder cannot configure host grants or control its parent
daemon. A draft `linux`/`browser` grant under this run's agent artifacts passed the
production profile decoder and scope selection. Its `kota-eval:review` image is
the deployment recipe's tag, not an inspected image; the host selects its reviewed
digest before activation. No model access, host mounts, credentials, or network
grant is requested. The existing service owner and deployment recipe supply the
activation path; no new service or capture format is required.

Resume through native profile inspection and the selected offline probe. A usable
credential writer remains unimplemented: the current anchored-filesystem owner
explicitly permits handles to follow relocated directories, and the task-probe
owner isolates disposable execution rather than publishing credentials to an
authorized host path. Neither is a safe replacement write primitive. Successful
private publication and adversarial root/staging relocation rejection with
unchanged outside sentinels remain unmet acceptance. The missing grant prevents
contained Linux experiments at that boundary; it does not establish that any
proposed writer design is correct.

## Current disposition verification

No production code changed. The existing browser profile lifecycle suite passed
all 11 tests in this workspace, exercising explicit-save/close rejection before
state collection, unchanged profiles, resource cleanup, existing-profile loading,
scope ownership and policy rejection. This proves retained containment only.
The draft host grant and current-source collection use the existing production
decoders and collector; their results are setup evidence, not Linux execution.
This run does not claim successful persistence, race safety, host activation, or
completion of the security fix. Run-specific setup and evidence stay under this
run's agent directory.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/browser/lifecycle.ts
claim:

> Browser profile persistence checks filesystem authority separately from the write. When persistProfile is enabled, a concurrent writer able to replace the profile file or an ancestor directory can redirect the path after validation but before Playwright writes it. This can write authenticated browser state outside the agent's declared write roots with the host process's permissions. The canonical-path recheck does not make the subsequent pathname-based write atomic.

## Desired Outcome

> Obtain storage state without supplying Playwright a filesystem path, then persist it through a runtime-owned write primitive that atomically enforces the authorized root and prevents symlink traversal, including ancestor replacement. Verify rejection of target changes between authorization and the actual write. This finding rests on static inspection; no exploitation was attempted.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-08T06-21-00-621Z-security-review-ikupt2.

Confirmed by security-review workflow runs:

- 2026-09-08T06-21-00-621Z-security-review-ikupt2

finding id: browser-profile-persistence-path-race
candidate id: secret-handling:src/modules/browser/AGENTS.md:43
verdict: confirmed
rationale:

> Static inspection confirms separate authorization and pathname-based persistence. src/modules/browser/browser-profile.ts:129-146 re-resolves the target, compares its pathname with the captured pathname, and checks allowed write roots, then returns a string. src/modules/browser/lifecycle.ts:221-235 subsequently passes that string to Playwright storageState without binding the write to a validated filesystem handle. With persistence enabled and a concurrent writer able to replace the target or an ancestor, the later write can resolve outside the authorized roots, subject to host filesystem permissions. The test at src/modules/browser/lifecycle-profile.test.ts:288 covers redirection before the close-time check, not replacement between validation and writing. Persistence needs a runtime-owned primitive that enforces containment during the actual write, including ancestor traversal.

Evidence:

Evidence 1:



path: src/modules/browser/browser-profile.ts

line: 129

excerpt:



> const currentPath = resolveBrowserProfileStoragePath(snapshot, identity);
>   if (currentPath !== capturedPath) {

Evidence 2:



path: src/modules/browser/browser-profile.ts

line: 137

excerpt:



> allowedWriteRoots !== undefined &&
>     !allowedWriteRoots.some((root) =>
>       isScopePolicyPathWithin(canonicalWriteRoot(root), currentPath)
>     )

Evidence 3:



path: src/modules/browser/lifecycle.ts

line: 221

excerpt:



> const resolved = resolveBrowserProfilePersistencePath(
>     resource,
>     resource.identity,
>     resource.storagePath,
>     resource.allowedWriteRoots,
>   );

Evidence 4:



path: src/modules/browser/lifecycle.ts

line: 235

excerpt:



> await resource.context.storageState({ path: resolved });

## Repair findings and mitigation

The first implementation was rejected by the critic. A controlled injection in
the actual Ruby helper moved the authorized root immediately before staging;
the helper returned success and persisted synthetic state outside the declared
root. Its directory descriptor and cwd followed the relocated root. Earlier
leaf and nested-directory swap tests did not prove this boundary.

The unsafe helper and its claimed authorized-write API have been removed.
Browser explicit save and close now fail closed before collecting or writing
credentials. Close still releases pages, context, process, and session resources.
The Playwright context port accepts no output path. Existing profiles still load
with persistProfile disabled; scope ownership and write-policy checks remain.
Configuration guidance, setup text, and source-access reports describe the
unavailable persistence capability.

This is a containment mitigation, not completion of the requested persistence
backend. The original finding and evidence above remain applicable to any
attempt to restore pathname-based writes without an enforced boundary.

## Repair verification

Browser owner tests: 13 suites, 89 tests passed, including explicit-save and
close rejection before storage-state collection, unchanged profile contents,
cleanup, existing-profile loading, scope isolation, and policy rejection.
Production and test TypeScript checks and scoped Biome checks passed. Tests ran on an identical source copy
under the run directory with dependencies installed from the offline cache,
because this repair workspace's node_modules is empty and read-only.

The decisive security proof is removal of the credential write path; no claimed
successful persistence or race-safe writer was established. The requested usable
persistence primitive remained unimplemented; containment was not completion.

## Second repair review

The second critic correctly rejected containment as completion: authorized
profiles still cannot be saved. No safe persistence backend was established
in this attempt, and no successful-persistence claim is made.

A fresh minimal macOS confinement probe exited 71 with
`sandbox-exec: sandbox_apply: Operation not permitted`. The existing runtime
sandbox launcher supplies process confinement, not a separately proven atomic
credential-write primitive. Reintroducing the previously defeated directory
handle writer would violate the task's security constraints. That attempt did not
establish a permitted execution surface or successful secure persistence.

The focused browser profile lifecycle suite passed all 11 tests against a
source-identical validation copy (every workspace src file was compared).
These tests establish containment, existing-profile reads, scope rejection,
and close cleanup; they do not establish successful secure persistence.

## Recovery assessment (2026-09-10)

The admitted source still requires successful secure persistence. Retained
containment is not completion. The refreshed issue-evidence export contains the
original security review and an unrelated historical-runtime capture; neither
supplies a task-attributable credential writer or relocation execution. No
scoped execution/export tool is exposed in this invocation.

The production contained-workspace resolver returned unavailable for Darwin
without running candidate code. Its exact result and observation provenance are
in the run artifact persistence-capability-assessment.json. This is a limitation
of the supplied runtime boundary, not a claim that the host lacks all relevant
capabilities. No unsandboxed candidate launcher was introduced.

Every workspace source file matches the existing validation copy. Inspection
confirms no browser storageState invocation remains, and the context port does
not accept an output path. Prior browser owner tests and TypeScript validation
remain applicable to these unchanged retained sources; they were not repeated.
The task validator was run after this task-body correction. Browser lifecycle,
configuration/setup, and reporting changes remain safe containment only.
Restoring functional persistence still requires implementation and positive and
adversarial boundary proof on an authorized contained execution surface.
