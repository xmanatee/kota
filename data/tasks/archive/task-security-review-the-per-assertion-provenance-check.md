---
status: done
---

# Security review: The per-assertion provenance check mistakes Vite transformation during test-file collection for execution by the selected assertion. A passing vacuous assertion can include unused top-level imports of every declared entrypoint; Vitest transforms those imports before applying the test-name filter, satisfying the transform-set check without exercising the claimed production ingress or retired boundary.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/repo-tasks/production-replacement-execution.ts
claim:

> The per-assertion provenance check mistakes Vite transformation during test-file collection for execution by the selected assertion. A passing vacuous assertion can include unused top-level imports of every declared entrypoint; Vitest transforms those imports before applying the test-name filter, satisfying the transform-set check without exercising the claimed production ingress or retired boundary.

## Desired Outcome

> Bind proof to assertion-scoped observable effects rather than module loading. Add a regression where the selected assertion passes while declared entrypoints are imported but unused, and require typed runtime observations, assertion-scoped coverage edges, or an equivalent mechanism proving the selected test actually exercised each ingress.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T07-25-44-834Z-security-review-j8wkmk.

finding id: production-replacement-transform-trace-is-not-assertion-provenance
candidate id: tool-execution:src/modules/repo-tasks/production-replacement-execution.ts:1
verdict: confirmed
rationale:

> Each binding is rerun with a test-name filter, but validateBindingProvenance only checks whether Vite transformed the declared entrypoints. Test-module imports are transformed during collection before the selected assertion runs, so unused top-level imports can satisfy this check while a vacuous selected assertion passes. No assertion-scoped runtime observation or coverage edge binds the entrypoint to that assertion.

Evidence:

Evidence 1:

path: src/modules/repo-tasks/production-replacement-execution.ts

line: 172

excerpt:

> The report check only requires one assertion whose fullName matches binding.name and whose status is "passed".

Evidence 2:

path: src/modules/repo-tasks/production-replacement-execution.ts

line: 182

excerpt:

> const missingEntrypoint = args.entrypoints.find((entrypoint) => !args.transformedPaths.has(entrypoint));

Evidence 3:

path: src/modules/repo-tasks/production-replacement-execution.ts

line: 237

excerpt:

> Each binding reruns its test file with --testNamePattern, then treats the run-wide transformedPaths set as that assertion's provenance.

Evidence 4:

path: src/modules/repo-tasks/production-replacement-vitest-paths.ts

line: 43

excerpt:

> collectTransformedRepoPaths collects every path appearing in vite:transform debug output without attributing it to a test assertion or runtime call.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Final Verification

- `pnpm test src/modules/repo-tasks/production-replacement-completion.test.ts src/modules/repo-tasks/production-replacement-task-move.test.ts src/modules/repo-tasks/production-replacement-vitest-paths.test.ts src/strict-types-policy.integration.test.ts` — 4 files and 9 tests passed.
- `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm hygiene` passed.
