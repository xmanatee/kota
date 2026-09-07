---
status: done
---
# Security review: Native workflow writers receive filesystem read access to the entire daemon run-state database and its journal files. On a multi-scope daemon, this exposes other scopes' workflow trigger payloads, persisted state, and external-effect results to the sandboxed agent. Checking writer identity in the task-mutation API does not restrict direct database reads.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/run-sandbox.ts
claim:

> Native workflow writers receive filesystem read access to the entire daemon run-state database and its journal files. On a multi-scope daemon, this exposes other scopes' workflow trigger payloads, persisted state, and external-effect results to the sandboxed agent. Checking writer identity in the task-mutation API does not restrict direct database reads.

## Desired Outcome

> Remove raw database and journal access from agent sandboxes. Keep active-attempt verification behind a runtime-owned boundary bound to the invoking run and workspace, returning only the necessary authorization result. Verify that writer task operations remain functional while unrelated scopes' records remain inaccessible.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-07T18-52-45-803Z-security-review-tyk3nf.

Confirmed by security-review workflow runs:

- 2026-09-07T18-52-45-803Z-security-review-tyk3nf

finding id: native-run-state-cross-scope-read
candidate id: tool-execution:src/core/workflow/run-sandbox.ts:1
verdict: confirmed
rationale:

> src/core/workflow/run-sandbox.ts:159 grants whole-file reads of kota.sqlite and its existing WAL/SHM files. src/core/agent-harness/native-cli-sandbox.ts:227 propagates these into sandbox readable roots; src/modules/codex-agent-harness/runtime-home.ts:50 translates them into read permissions. src/core/daemon/daemon-context-factory.ts:86 creates one database shared across registered scopes. That database stores trigger payloads (run-state-database.ts:306), scope state (run-state-database.ts:864), and external-effect results (run-state-database.ts:1441). The active-attempt checks in src/core/workflow/run-context.ts:123 constrain task API authorization, but cannot constrain direct reads of the permitted database files. This confirms a cross-scope confidentiality boundary violation when unrelated scopes have persisted records. Replace raw database access with runtime-owned, run-bound authorization.

Evidence:

Evidence 1:



path: src/core/workflow/run-sandbox.ts

line: 159

excerpt:



> const stateDatabase = join(resolvedStateDir, "kota.sqlite");
> return [
>   stateDatabase,
>   `${stateDatabase}-wal`,
>   `${stateDatabase}-shm`,
> ].filter(existsSync).map(comparablePath);

Evidence 2:



path: src/core/agent-harness/native-cli-sandbox.ts

line: 227

excerpt:



> ...nativeRunOwnershipReadRoots(options.cwd, options.env, [
>   ...options.writableRoots,
>   ...explicitRuntimeWritableRoots,
> ]),

Evidence 3:



path: src/core/daemon/daemon-context-factory.ts

line: 86

excerpt:



> runState = new RunStateDatabase(stateDir);
> for (const scope of scopeRegistry.list()) {
>   runState.registerScope({
>     id: scope.scopeId,
>     rootPath: scope.scopeRoot,
>     displayName: scope.displayName,
>     createdAt: state.startedAt,
>   });
> }

Evidence 4:



path: src/core/workflow/run-state-database.ts

line: 306

excerpt:



> `INSERT INTO runs
>   (id, scope_id, workflow, trigger_json, repository_access, state,
>    admitted_at, not_before_at)
>  VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
> )
> .run(
>   input.id,
>   input.scopeId,
>   input.workflow,
>   JSON.stringify(input.trigger),

Evidence 5:



path: src/core/workflow/run-state-database.ts

line: 1441

excerpt:



> `UPDATE external_effects
>  SET state = 'completed', completed_at = ?, result_json = ?
>  WHERE effect_key = ? AND run_id = ? AND state = 'prepared'`,
> )
> .run(input.completedAt, JSON.stringify(input.result), input.key, input.runId);

## Resolution and verification

Removed the raw SQLite/WAL/SHM read-root grant and the native task command's
read-only database reconstruction. The shared native harness now hosts a
per-invocation authorization boundary tied to the run, attempt, daemon epoch,
and canonical writer workspace. Each task mutation uses a fresh challenge; the
host rechecks durable active-attempt ownership and returns only a boolean in a
sandbox-read-only response directory. Only request names are consumed, so
agent-controlled request contents and symlinks are never opened by the host.
Responses and the host database connection are cleaned up with the invocation.
The daemon database locator is removed from the child environment, and database,
WAL, SHM, and rollback-journal paths are explicitly denied even beneath a broader
read grant. Workflow and repo-task instructions describe this ownership boundary.

Proof:

- Production and test TypeScript checks passed. Scoped Biome checks and Git
  whitespace checks passed.
- The native authorization integration worker test passed through the production
  native-CLI projection and task mutation domain: task creation/completion works
  in the writer only; forged run, attempt, epoch, and workspace identities and a
  missing invocation capability fail; ending the attempt revokes subsequent
  mutations; closing the invocation removes its response surface. The native
  permission projection excludes raw database reads and protects responses.
- Focused task-mutation owner and Codex permission-renderer tests passed. The
  combined existing sandbox/owner selection reported 16 passes, one skip, and
  one environment failure: its loopback listener cannot bind (listen EPERM).
- The OS sandbox integration regression seeds another scope's private trigger
  in the shared database and probes database/WAL/SHM reads, response forgery, and
  legitimate task completion. Execution is unavailable in this enclosing
  sandbox: sandbox-exec reports sandbox_apply: Operation not permitted before
  the probe starts. It remains fail-closed, with no unsandboxed fallback. Actual
  OS enforcement of this new scenario still needs an unrestricted test host;
  no successful OS probe is claimed.

Critic repair: Linux previously selected read masks only beneath explicit read
roots even though writable and runtime-boundary mounts also exposed host files.
Mask selection now covers every mounted root, with denials applied after those
mounts. The OS integration fixture no longer grants the state directory extra
read access. Owner regression cases cover readable, writable, and write-boundary
mounts, including database journals and protected directories.

A direct Node probe invoked the production launch generator and path resolution
using real temporary files. The pre-repair generator from Git failed the writable
and write-boundary cases; the repaired generator passed all three cases, kept the
writer writable, and rejected a missing directory mask. Probe source and outputs
are retained as `linux-mount-probe.mjs`, `linux-mount-baseline.txt`, and
`linux-mount-fixed.txt` in this run's agent directory. This proves Linux permission
projection, not actual bubblewrap enforcement. In this repair environment Vitest
and tsx are missing, and the sandbox prevents restoring node_modules; the focused
owner suite and normal task-validator command could not start. The prior OS-probe
limitation above remains applicable. The production task validator subsequently
passed via Node's TypeScript transform and a source-import resolver, reporting
zero errors and zero warnings. Node accepted the changed TypeScript syntax and
Git whitespace validation passed; these do not substitute for typechecking or
executing the Vitest suites.

The confirmed finding and original cited evidence above are retained. The
legacy sandbox of this already-running builder is not changed or restarted by
this patch; the corrected permissions apply to subsequent native launches.
