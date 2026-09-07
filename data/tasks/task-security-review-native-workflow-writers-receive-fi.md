---
status: open
priority: p2
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
