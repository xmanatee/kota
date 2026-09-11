---
status: done
---
# Security review: Standalone daemon startup stores its control bearer token in daemon-instance.lock, but the shared protected-file policy omits that filename. The production file_read boundary therefore exposes a credential that daemon-control.json deliberately protects. An executed synthetic probe returned the credential sentinel from the lock while rejecting the control file; the lock was also absent from the native denial projection. No real credential was accessed.

security family: 4c91f89122ff40f4a102d65f16a470a68e878722df1df8ce4089b9955d21a867


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/daemon-instance-lock.ts
claim:

> Standalone daemon startup stores its control bearer token in daemon-instance.lock, but the shared protected-file policy omits that filename. The production file_read boundary therefore exposes a credential that daemon-control.json deliberately protects. An executed synthetic probe returned the credential sentinel from the lock while rejecting the control file; the lock was also absent from the native denial projection. No real credential was accessed.

## Desired Outcome

> Protect daemon-instance.lock through the shared runtime-credential read policy, including file reads, searches, native sandbox projections, and resolved aliases. This closes the omitted credential location while preserving instance-lock ownership behavior.

> Close the shared credential-path omission and verify rejection using synthetic lock credentials through production read/search boundaries and native permission projection. Preserve ordinary repository access. Evidence is retained in security-investigation-evidence.json in the agent run directory. Historical native protection work fixed consumption of existing denials; historical file-mode work protected other OS users. Neither repair addressed this omitted filename, so this finding has no matching existing repair task.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-11T04-24-51-248Z-security-review-t7qlj3.

Confirmed by security-review workflow runs:

- 2026-09-11T04-24-51-248Z-security-review-t7qlj3

security evidence: 3264226ae8bb1128902a35493273648b29b394437f985e41af852fb85f2c85ae
evidence identity: standalone-instance-lock-token-readable-v1
production owner: src/core/tools/protected-scope-paths
violated invariant: runtime-credentials-must-not-enter-agent-context
Common repair:
> Protect daemon-instance.lock through the shared runtime-credential read policy, including file reads, searches, native sandbox projections, and resolved aliases. This closes the omitted credential location while preserving instance-lock ownership behavior.
Exploit preconditions:
> A standalone daemon starts without supervisorInstanceToken, and an agent running as the daemon user has file_read access to its canonical scope directory without an additional blanket runtime-directory denial. Attacker-controlled task or tool content induces the agent to read .kota/daemon-instance.lock. Subsequent control-API use additionally requires access to the daemon's loopback endpoint; native network confinement is not claimed bypassed. Supervised daemons use a separate supervisor lock token, so the identical control-token claim is limited to standalone operation.
finding id: standalone-instance-lock-credential-disclosure
candidate id: daemon-control-route:src/core/daemon/daemon-instance-lock.ts:20
verdict: confirmed
rationale:

> At a1022e259efc4d4c1d046a7ac417b86924baf5c9, standalone startup passes the same token to instance-lock persistence and the control authorizer. protected-scope-paths.ts omits daemon-instance.lock. An independent synthetic probe confirmed production runFileRead returns the lock credential directly and through a symlink while rejecting daemon-control.json; the native protected-path projection also omits the lock. The production authorizer accepted the synthetic token as bearer authority. Exploitation requires the stated same-user read access; subsequent API use additionally requires loopback reachability. Supervised operation uses a separate lock token. The shared credential-path repair addresses this omission across consumers. Historical file-mode and native-denial-consumption repairs address different defects, supporting null task nomination and lineage.

Evidence:

Evidence 1:



path: src/core/daemon/daemon-context-factory.ts

line: 78

excerpt:



> const token = randomBytes(32).toString("hex");
> const instanceIdentity = {
>   pid: state.pid,
>   startedAt: state.startedAt,
>   token,
> };
> if (config.supervisorInstanceToken !== undefined) {
>   assertSupervisorInstanceLock(stateRoot, config.supervisorInstanceToken);
> } else {
>   await acquireInstanceLock(scopeRoot, stateRoot, instanceIdentity, log);
> }

Evidence 2:



path: src/core/daemon/daemon-instance-lock.ts

line: 87

excerpt:



> const contents = `${JSON.stringify(owner, null, 2)}\n`;
> return reserveDaemonInstanceLockFile(
>   stateRoot,
>   INSTANCE_LOCK_FILE,
>   contents,
> );

Evidence 3:



path: src/core/daemon/daemon-startup.ts

line: 72

excerpt:



> writeControlFile(ctx.stateRoot, {
>   port: controlPort,
>   pid: process.pid,
>   startedAt: ctx.state.startedAt,
>   token: ctx.token,
> });

Evidence 4:



path: src/core/tools/protected-scope-paths.ts

line: 13

excerpt:



> export const PROTECTED_SCOPE_RUNTIME_FILES = [
>   ".kota/daemon-control.json",
>   ".kota/secrets.json",
> ] as const;

Evidence 5:



path: src/modules/filesystem/file-read.ts

line: 58

excerpt:



> const filePath = resolveToolPath(rawFilePath, context);
> if (isProtectedScopePath(filePath, context)) {
>   return { content: protectedScopePathError(rawFilePath), is_error: true };
> }


## Resolution

Added `.kota/daemon-instance.lock` to the shared protected runtime credential
policy. File reads and listings inherit that denial, including resolved file and
directory symlinks. Search exclusions now derive from the same runtime-file list;
search roots resolve before invocation so a directory alias cannot bypass ripgrep's
path exclusion. Native sandbox discovery and Codex workspace permissions consume
the shared policy. Daemon lock acquisition, ownership checks and release are unchanged.

## Verification

- `pnpm check:fast` passed: production/test typechecking, lint, task validation,
  and generated client-binding checks.
- `pnpm test:owner src/modules/filesystem src/core/tools/protected-scope-paths.test.ts src/core/daemon/daemon-instance-lock.test.ts src/modules/codex-agent-harness/runtime-home.test.ts`
  passed 194 tests in 18 files. Synthetic lock credentials exercise production
  file reads, direct and recursive searches with real ripgrep and fallback grep,
  file and directory symlinks, and credential listing exclusion. Positive controls
  preserve ordinary repository reads/searches. Existing lock-owner tests establish
  acquisition, stale-owner recovery and release behavior remains intact.
- The focused `native-cli-sandbox.test.ts` case `projects the persisted daemon lock`
  passed: the production native preparation boundary includes the lock in read
  denials while retaining repository access.
- The initial six-file run passed 80 tests, skipped two native execution cases,
  and failed the unrelated provider-proxy/loopback case at listener creation with
  `listen EPERM: operation not permitted 127.0.0.1`. Native OS confinement was not
  established in this sandbox; native permission projection was established.

All credential fixtures were synthetic. No real credential or running daemon
endpoint was accessed. Evidence and proposed commit message are retained under
builder run `2026-09-11T10-29-24-102Z-builder-ykjq28`.
