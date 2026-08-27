---
status: done
---

# Security review: After the isolated fixture executor returns, shell predicates and shell-backed objective metrics execute commands from the agent-mutated working directory directly on the evaluator host. They inherit the evaluator environment and host network/process access. Shipped scorers import agent-written modules, so malicious fixture output can execute arbitrary host code, access daemon credentials, exfiltrate data, or leave detached processes outside the configured container boundary.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/predicates.ts
claim:

> After the isolated fixture executor returns, shell predicates and shell-backed objective metrics execute commands from the agent-mutated working directory directly on the evaluator host. They inherit the evaluator environment and host network/process access. Shipped scorers import agent-written modules, so malicious fixture output can execute arbitrary host code, access daemon credentials, exfiltrate data, or leave detached processes outside the configured container boundary.

## Desired Outcome

> Execute every executable predicate and objective-metric command inside the same verified offline container/PID/resource boundary used for the fixture, with a minimal secret-free environment and full process-tree cleanup. Mount trusted verifier code separately as immutable read-only content and expose agent-produced code only through the explicitly constrained candidate interface. Fail closed when that verifier boundary is unavailable.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-26T09-17-25-790Z-security-review-2unzg0.

finding id: security-review-eval-host-shell-verifier-escape
candidate id: tool-execution:src/modules/eval-harness/predicates.ts:12
verdict: confirmed
rationale:

> The isolated workflow returns at runner-single-fixture.ts:168-191, after which predicates and metrics execute at lines 193-214 in the host evaluator. predicates.ts:422-434 and objective-metrics.ts:403-417 invoke shell commands directly with spawnSync, while protected-git-env.ts:39-58 preserves process.env except for Git configuration. The shipped scorer at fixtures/builder-empirical-code-optimization/initial/scripts/score.mjs:1-2 imports agent-modifiable src/predictor.mjs, providing direct host code execution outside the container's network, resource, and process-lifetime controls.

Evidence:

Evidence 1:

path: src/modules/eval-harness/predicates.ts

line: 422

excerpt:

> evaluateShell invokes spawnSync(predicate.command) with shell: true, cwd: workingDir, and env: withProtectedGitBareRepositoryEnv().

Evidence 2:

path: src/modules/eval-harness/objective-metrics.ts

line: 403

excerpt:

> extractShellMetric repeats the host-side shell execution pattern for objective metrics, using the mutable workingDir and inherited process environment.

Evidence 3:

path: src/modules/eval-harness/runner-single-fixture.ts

line: 193

excerpt:

> evaluatePredicates and evaluateObjectiveMetricsForOutcome run only after executor.execute has returned, placing these commands outside the executor's isolation boundary.

Evidence 4:

path: src/core/util/protected-git-env.ts

line: 39

excerpt:

> withProtectedGitBareRepositoryEnv defaults baseEnv to process.env and copies it before changing only Git configuration variables.

Evidence 5:

path: src/modules/eval-harness/fixtures/builder-empirical-code-optimization/initial/scripts/score.mjs

line: 2

excerpt:

> The shipped host-executed scorer imports predict from ../src/predictor.mjs, which is the agent-owned implementation under evaluation.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Resolution

Fixed on 2026-07-26. Git and shell predicates plus shell-backed objective
metrics no longer spawn from the evaluator host. They now share the fixture's
verified container backend and execution profile through a disposable offline
verifier with a secret-free command environment, read-only fixture-owned
scorer overlays, bounded resources/output/time, and confirmed forced container
cleanup. Missing isolation, abnormal execution, mutable scorer-path tricks,
and unconfirmed cleanup all fail closed. Git scoring also disables repository
fsmonitor and hooks, so agent-controlled Git configuration cannot introduce an
extra executable scorer path.

Final verification command:

`sh .kota/tmp/2026-07-26T09-17-25-482Z-builder-yhb38n/verify-isolated-verifier.sh`

The tracked result is in
`.kota/runs/2026-07-26T09-17-25-482Z-builder-yhb38n/validation.txt`.
