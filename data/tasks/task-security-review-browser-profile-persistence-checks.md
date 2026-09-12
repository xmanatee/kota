---
status: blocked
priority: p2
depends_on: [task-run-contained-linux-runtime-probes]
---
# Security review: Browser profile persistence checks filesystem authority separately from the write. When persistProfile is enabled, a concurrent writer able to replace the profile file or an ancestor directory can redirect the path after validation but before Playwright writes it. This can write authenticated browser state outside the agent's declared write roots with the host process's permissions. The canonical-path recheck does not make the subsequent pathname-based write atomic.

## Repair implementation and remaining proof

The repair adds the candidate `publishPrivateFile` boundary under the existing
core filesystem owner, with a Linux Python helper and public-boundary tests.
It walks from `/` with no-follow directory opens and accepts only layouts whose
ancestors above the destination directory are root-owned and not writable by
unprivileged users. The helper refuses root, setuid identities and Linux
capabilities. This is a deliberate supported-layout restriction: ordinary nested
workspace directories remain unavailable. Administrators, rather than concurrent
unprivileged writers, control the immutable ancestry.

Credential bytes and permissions are written only on an anonymous `O_TMPFILE`
inode. After filling and syncing that inode, descriptor-relative link/replace
operations publish completed bytes inside the protected directory; the helper
never writes or chmods a named inode. Target snapshots detect changes during
collection/staging. They are not atomic compare-and-swap: a final racing leaf
replacement is replaced as an entry rather than followed. No claim of atomic
conditional-update semantics is made.

**Browser activation remains closed.** The candidate publisher is not called by
browser lifecycle or any other production consumer yet. The earlier temporary
wiring was removed because this contract requires boundary qualification before
activation. Existing explicit-save/close rejection, no credential collection,
profile loading and cleanup remain intact. Once the owner proof passes, connect
`persistResource` to the publisher's `collect` callback using path-free
`context.storageState()` and verify explicit save plus close through the real
publisher. No additional service, host execution bridge, configuration bypass or
privileged launcher was added.

The contained-evaluation example now selects both the core private-file suite
and the browser suite and describes their Python/procfs/non-root prerequisites.
The existing browser CLI test had an obsolete exact argument assertion; it now
includes the production loader's existing `scopeRoot` argument. No CLI behavior
changed.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: Trusted-host activation of a scope-authorized offline Linux probe profile for the private-file boundary; native inspection or an equivalent attributable capability export permits resumption without manual captures.

The path is an evidence-discovery hint in the existing precondition vocabulary,
not a required filename, manual capture or request for owner permission.

The existing native contained-evaluation service must expose an authorized
offline Linux probe profile for this canonical scope. This repair invoked
`pnpm kota eval contained '{"operation":"inspect"}'` through the maintained
mediation and received `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host
environment` (tool use `tool-f9983c7e04a7729e42c5c10b4563a27f`). This is an actual
host response, not an inference from a Darwin sandbox denial. The builder cannot
supply that host grant or control its parent daemon. No repeated unchanged
readiness call or alternate execution bridge is needed.

The exact outstanding checks are actual unprivileged Linux private creation and
replacement (complete bytes, mode 0600, single link), changed-leaf rejection with
an unchanged sentinel outside the write grant, and adversarial root/staging
relocation assessment at the owning boundary. The six Linux owner cases are
present but unexecuted here; a skipped test is not proof. Browser integration
must remain inactive until that qualification, then receive its save/close
composition check. No successful Linux publication, race-safety certification or
finished security fix is claimed. Host activation is not a generic deployment
monitoring gate: it is the unavailable execution surface for these specific
pre-activation security checks, after candidate implementation and local
validation have advanced.


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

Implement the missing credential writer now. Host activation is a prerequisite
for the final contained Linux observation, not for tracing maintained consumers,
choosing the owning primitive, implementing it or exercising available tests.
Use proportionate proof at that owner; do not add another execution bridge or
repeat unchanged readiness calls. Preserve the fail-closed mitigation wherever
the replacement cannot enforce the boundary. It is not feature completion.
Publish useful implementation independently of deployment observation, reporting
unperformed Linux checks honestly. Block again only when no implementation or
available validation can advance the task, naming the exact remaining check.
Do not weaken containment or restore the defeated writer. The host monitor owns
deployment follow-up; no separate operator-readiness artifact is required.

## Deployment Follow-up

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

Once activation is available, validate through native profile inspection and the
selected offline probe. A usable credential writer remains unimplemented: the current anchored-filesystem owner
explicitly permits handles to follow relocated directories, and the task-probe
owner isolates disposable execution rather than publishing credentials to an
authorized host path. Neither is a safe replacement write primitive. Successful
private publication and adversarial root/staging relocation rejection with
unchanged outside sentinels remain unmet acceptance. The missing grant prevents
contained Linux experiments at that boundary; it does not establish that any
proposed writer design is correct.

## Current disposition verification

The final browser/private-file owner run passed 81 tests across 14 suites;
six Linux-only cases were skipped on Darwin. The executed cases establish
continued rejection before credential collection, unchanged profiles, cleanup,
existing-profile reads, scope/write-policy rejection and the maintained browser
consumers. They do not establish the candidate's positive Linux behavior.

Production and test TypeScript checks, repository lint, task validation, generated
client/UI binding checks and module admission passed. Python compiled the embedded
helper successfully; an actual isolated Python invocation on Darwin returned the
expected unsupported-runtime rejection without filesystem mutation. The final
production TypeScript emission and runtime-asset copy passed. The `pnpm build`
wrapper's clean step could not remove generated directories (`Operation not
permitted`), so those two build operations were run directly without changing
permissions or weakening isolation. No native client contract changed.

Scoped Git inspection confirms the production browser lifecycle, configuration,
setup and source-access report are unchanged; only guidance and the stale CLI
test assertion changed in that module. The candidate publisher has no production
caller, so the unavailable Linux proof cannot activate unreviewed credential
writes. Historical sections below preserve the original finding and rejected
attempts. Run-specific evidence and the proposed commit message remain under the
`2026-09-12T20-19-32-959Z-builder-pbera3` agent directory.


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
