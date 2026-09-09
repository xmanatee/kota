---
status: done
---
# Security review: Post-run evidence collection executes Git against the candidate workspace directly on the evaluator host. Candidate code executed during containerized verification can modify the writable repository configuration. The collector subsequently honors executable Git configuration, including external diff, textconv, and filesystem-monitor helpers, outside the container and with the host environment. This permits candidate-controlled execution across the evaluator isolation boundary.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/runner-evidence.ts
claim:

> Post-run evidence collection executes Git against the candidate workspace directly on the evaluator host. Candidate code executed during containerized verification can modify the writable repository configuration. The collector subsequently honors executable Git configuration, including external diff, textconv, and filesystem-monitor helpers, outside the container and with the host environment. This permits candidate-controlled execution across the evaluator isolation boundary.

## Desired Outcome

> Move evidence Git commands into the existing offline evaluator sandbox with stripped credentials and bounded execution. Disable external diff, textconv, filesystem-monitor helpers, and other executable repository configuration. Verify that candidate-modified Git configuration cannot cause host execution during evidence collection.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-09T15-37-31-681Z-security-review-vmf6gp.

Confirmed by security-review workflow runs:

- 2026-09-09T15-37-31-681Z-security-review-vmf6gp

finding id: eval-evidence-host-git-execution
candidate id: tool-execution:src/modules/eval-harness/runner-evidence.ts:1
verdict: confirmed
rationale:

> Static inspection confirms the isolation violation. runner-materialize.ts:68-96 initializes .git inside the candidate workspace. executable-verifier-sandbox.ts:136-155 runs verification with the host UID/GID and mounts that entire workspace writable, leaving repository configuration mutable by candidate code. runner-single-fixture.ts:195-217 completes scoring before runner.ts:26-29 invokes evidence collection. runner-evidence.ts:34 executes host Git directly; its diff commands at lines 112-117 do not disable external diff, textconv, or filesystem-monitor helpers. protected-git-env.ts:39-58 preserves process.env and only enforces safe.bareRepository, which does not disable these executable configuration mechanisms. Thus candidate-modified repository configuration can trigger execution with evaluator-host privileges during collection. Existing predicate protections in predicates.ts:95 and :270 do not cover this collector.

Evidence:

Evidence 1:



path: src/modules/eval-harness/executable-verifier-sandbox.ts

line: 155

excerpt:



> bindMount(params.workingDir, params.workingDir, false),

Evidence 2:



path: src/modules/eval-harness/runner.ts

line: 26

excerpt:



> const report = isMultiRoundFixtureSpec(params.fixture.spec)
>     ? await runMultiRoundFixture(params)
>     : await runSingleWorkflowFixture(params);
>   report.run.executionEvidence = collectFixtureExecutionEvidence(report);

Evidence 3:



path: src/modules/eval-harness/runner-evidence.ts

line: 34

excerpt:



> return execFileSync("git", args, { cwd: workingDir, encoding: "utf8", env: withProtectedGitBareRepositoryEnv(), maxBuffer: 16 * 1024 * 1024 });

Evidence 4:



path: src/modules/eval-harness/runner-evidence.ts

line: 115

excerpt:



> let diff = git(report.workingDir, ["diff", initial, "--", ...paths]);

Evidence 5:



path: src/core/util/protected-git-env.ts

line: 39

excerpt:



> export function withProtectedGitBareRepositoryEnv(
>   baseEnv: NodeJS.ProcessEnv = process.env,
> ): NodeJS.ProcessEnv {
>   const env: NodeJS.ProcessEnv = { ...baseEnv };


## Resolution and verification

Post-run evidence Git now runs exclusively through the existing offline executable-verifier sandbox with the actual candidate tree. A typed workspace view keeps trusted scorer overlays exclusive to scoring, so candidate edits and deletions under scripts remain visible in retained evidence. The runner awaits collection before returning for both single and multi-round fixtures. Collection strips the Git process environment, disables external diff, textconv, filesystem monitoring, hooks, remote transport, submodule recursion, and configured content filters (including included configuration), and bounds aggregate duration and output. Unavailable isolation, process failures, signals, or output-limit errors retain an explicit evidence issue without a host fallback or partial patch.

The eval-harness module owns this fix and its scoped instructions now cover the post-run boundary. Regression checks exercise runFixture with real Git behind the controlled OCI subprocess port, malicious candidate configuration, modified and deleted scorer files, tracked and untracked files, shell-sensitive filenames, and unavailable isolation. Collector checks cover failures while appending an untracked patch. Because the controlled backend does not implement mounts, the regression also checks that production evidence requests mount only the candidate workspace; scoring sandbox checks retain the immutable scorer mount requirement. Raw content is retained and the candidate helper marker is absent. Existing sandbox checks verify offline resource and credential propagation and forced cleanup; existing single and multi-round runner checks verify the asynchronous handoff.

Validation passed: 25 distinct owner tests across runner-evidence, executable-verifier-sandbox, runner-execution-outcomes, runner, and runner-multi-round; production and test TypeScript checks; scoped Biome checks. Static inspection confirms no host Git execution remains in the post-run collector. A live OCI probe could not run because Docker socket access is denied in this builder environment; the tests use the established simulated container backend, not a claim of live container enforcement.
