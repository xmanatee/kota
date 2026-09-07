---
status: open
priority: p2
---
# Security review: Database read protection depends on writer authorization. A native CLI invocation without writer identity, running from the daemon's canonical repository, receives repository-wide read access without denials for kota.sqlite or its journals. On a multi-scope daemon, this exposes other scopes' persisted workflow data. The writer fix therefore leaves a non-writer cross-scope confidentiality gap.


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
