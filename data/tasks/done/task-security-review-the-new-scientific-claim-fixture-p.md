---
id: task-security-review-the-new-scientific-claim-fixture-p
title: Security review: The new scientific-claim fixture permits the builder to modify scripts/analyze-claim.mjs and then scores the run by executing a shell predicate in the parent harness process. check-claim.mjs spawns that mutable analyzer, so model-authored code can run on the operator host with the parent environment after any containerized workflow execution has finished.
status: done
priority: p1
area: security
summary: The new scientific-claim fixture permits the builder to modify scripts/analyze-claim.mjs and then scores the run by executing a shell predicate in the parent harness process. check-claim.mjs spawns that mutable analyzer, so model-authored code can run on the operator host with the parent environment after any containerized workflow execution has finished.
created_at: 2026-05-27T10:07:33.408Z
updated_at: 2026-05-27T10:26:33Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/initial/scripts/check-claim.mjs
claim: The new scientific-claim fixture permits the builder to modify scripts/analyze-claim.mjs and then scores the run by executing a shell predicate in the parent harness process. check-claim.mjs spawns that mutable analyzer, so model-authored code can run on the operator host with the parent environment after any containerized workflow execution has finished.

## Desired Outcome

Run executable predicates inside the same verified isolation backend as the workflow, or change this fixture so host-side predicates only parse fixed artifacts and never execute agent-modified code.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-27T10-01-16-684Z-security-review-0txbhp.

finding id: sr-2026-05-27-eval-fixture-host-code-execution
candidate id: tool-execution:src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/initial/scripts/check-claim.mjs:1
verdict: confirmed
rationale: The reported flow is present in current code. The fixture declares a host shell predicate at src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/fixture.json:9 and permits changes to scripts/analyze-claim.mjs at fixture.json:41. runFixture executes the workflow first, then evaluates predicates in the parent process at src/modules/eval-harness/runner.ts:324 and runner.ts:347. shell-succeeds predicates run via spawnSync with shell: true, cwd set to the fixture working directory, and env from withProtectedGitBareRepositoryEnv at src/modules/eval-harness/predicates.ts:342, which copies process.env at src/core/util/protected-git-env.ts:39. check-claim.mjs then spawns the mutable analyzer at src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/initial/scripts/check-claim.mjs:176 without an env override, so model-authored analyzer code can execute on the host with inherited parent environment after even a container-backed workflow run.

Evidence:

- src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/fixture.json:9 - "kind": "shell-succeeds"
- src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/fixture.json:43 - "scripts/analyze-claim.mjs"
- src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/initial/scripts/check-claim.mjs:177 - return spawnSync(
- src/modules/eval-harness/runner.ts:347 - const { passed, results } = evaluatePredicates(
- src/modules/eval-harness/predicates.ts:347 - const result = spawnSync(predicate.command, {
- src/core/util/protected-git-env.ts:40 - baseEnv: NodeJS.ProcessEnv = process.env

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/modules/eval-harness/scientific-claim-reproduction-fixture.test.ts src/modules/eval-harness/predicates.test.ts src/strict-types-policy.integration.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm build` passed.
- `pnpm run validate-tasks` passed after staging the task move.
