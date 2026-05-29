---
id: task-security-review-provider-egress-eval-runs-place-pr
title: Security review: Provider-egress eval runs place provider API keys directly in Docker CLI argv via --env KEY=value, exposing secrets to local process-list inspection for the duration of the container run.
status: done
priority: p2
area: security
summary: Provider-egress eval runs place provider API keys directly in Docker CLI argv via --env KEY=value, exposing secrets to local process-list inspection for the duration of the container run.
created_at: 2026-05-29T13:01:14.835Z
updated_at: 2026-05-29T13:07:49.196Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/eval-harness/subprocess-executor.ts
claim: Provider-egress eval runs place provider API keys directly in Docker CLI argv via --env KEY=value, exposing secrets to local process-list inspection for the duration of the container run.

## Desired Outcome

Do not serialize secret values into docker argv. Pass provider auth through a safer boundary such as a 0600 temporary env file with lifecycle cleanup or Docker secret-style support, and add a regression test proving provider auth values do not appear in containerRunArgs/child argv.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T12-56-11-087Z-security-review-66a4yi.

finding id: provider-egress-docker-argv-secret-exposure
candidate id: secret-handling:src/modules/eval-harness/subprocess-executor.ts:698
verdict: confirmed
rationale: Provider-egress container runs copy provider auth values from process env in eval-operations.ts:96-113, pass them as extraEnv at eval-operations.ts:185-189, merge them into the container env map at subprocess-executor.ts:650-658, and serialize every env entry into Docker-style argv as --env KEY=value at subprocess-executor.ts:698-701 and subprocess-executor.ts:748-763. createSubprocessExecutor then spawns the container executable with those args at subprocess-executor.ts:890-928, so provider API keys are present in the local child process argv while the container command runs.

Evidence:

- src/modules/eval-harness/provider-egress.ts:133 - const PROVIDER_AUTH_ENV_KEYS: Readonly<Record<ProviderEgressProvider, readonly string[]>> = {
- src/modules/eval-harness/eval-operations.ts:106 - const authEnv: Record<string, string> = {};
- src/modules/eval-harness/eval-operations.ts:188 - extraEnv: providerEgressAuthEnvForRun(isolationBackend),
- src/modules/eval-harness/subprocess-executor.ts:650 - const env = withProtectedGitBareRepositoryEnv({
- src/modules/eval-harness/subprocess-executor.ts:698 - function envArgs(env: Record<string, string>): string[] {
- src/modules/eval-harness/subprocess-executor.ts:701 - .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
- src/modules/eval-harness/subprocess-executor.ts:762 - ...envArgs(params.env),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/eval-harness/subprocess-executor.test.ts` passed (20 tests), including a provider-egress regression assertion that the provider auth value is absent from Docker argv while still present in the container environment.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
