---
status: done
---
# Complete hosted harness registration repair for token-budget fixtures

## Problem

Gemini and OpenAI adapter-token-budget fixtures still mock tool catalogs and execution without registering their echo tool. Their successful execution cases fail before reaching the intended ledger, session, cwd and workflow propagation boundary. Both failures reproduce independently of the broader run's worker errors.

Investigation: The completed repair removes simulated registration ownership from the identified permission and scaffold fixtures; focused verification confirms those outcomes. Reassessment of 6b7955e71b980a5e4c36d653 still finds no justified production catalog-filter extraction. Observations b78251422d7d0e73461773e3, 3acd08c4dc3725927432f2d8 and 2d9b86c81ecd9b92530034a5 are false positives: the scaffold helper is excluded from production builds, consumed only by tests, and absent from dynamic module entrypoints. However, neighboring Gemini and OpenAI token-budget fixtures retain the same simulated registration problem. An isolated baseline reproduced two failures with six passes; removing their core-tools mocks and adding canonical registrations in scratch made all eight checks pass. This counterevidence warrants reopening task-generated-1ea0c77f72276d04 under its existing mechanism key at p2. The previous delivery did not claim these independent suites passed. No supplied delivery issue has an established causal link. Other structural leads remain unassessed. No tracked files changed.

Evidence:
- 6b7955e71b980a5e4c36d653
- b78251422d7d0e73461773e3
- 3acd08c4dc3725927432f2d8
- 2d9b86c81ecd9b92530034a5
- git:f94dee528364339ca72a6a8fe2074c97a9ba059f
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- data/tasks/archive/task-generated-1ea0c77f72276d04.md
- data/tasks/archive/task-add-rollout-token-budgets-to-workflow-agent-runs.md
- data/tasks/task-capture-an-end-to-end-coding-task-parity-artifact-.md
- data/tasks/task-run-live-openrouter-and-local-model-rollout-evalua.md
- src/modules/gemini-agent-harness/adapter-token-budget.test.ts
- src/modules/openai-tools-agent-harness/adapter-token-budget.test.ts
- src/modules/gemini-agent-harness/adapter-test-support.ts
- src/modules/vercel-agent-harness/adapter-test-support.ts
- src/modules/openai-tools-agent-harness/adapter-shared-runner-test-support.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold-test-support.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold.test.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold-verification.test.ts
- src/core/tools/tool-registry.ts
- src/core/tools/local-tool-approval-binding.ts
- src/core/tools/tool-runner-execute-block.ts
- src/core/modules/bundled-module-discovery.ts
- src/core/modules/runtime-module-discovery.ts
- src/core/modules/module-deps.test.ts
- src/modules/openai-tools-agent-harness/index.ts
- src/modules/architecture-gardener/ast-provider.ts
- tsconfig.build.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-44-58-192z-archite-792933f90f5daed794d04f9f3a4e365ff43d06f8d23340b2bf2a57de8812f720/agent/harness-registration-followup.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-44-58-192z-archite-792933f90f5daed794d04f9f3a4e365ff43d06f8d23340b2bf2a57de8812f720/agent/token-budget-baseline.log
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-44-58-192z-archite-792933f90f5daed794d04f9f3a4e365ff43d06f8d23340b2bf2a57de8812f720/agent/token-budget-registration-probe.patch
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-44-58-192z-archite-792933f90f5daed794d04f9f3a4e365ff43d06f8d23340b2bf2a57de8812f720/agent/token-budget-registration-probe.log

## Desired Outcome

Both token-budget suites exercise permissioned tool dispatch through canonical registrations. Removing their remaining simulated registry ownership is expected to reduce fixture drift; future maintenance benefit remains unmeasured.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Gemini adapter token-budget verification
- OpenAI tools adapter token-budget verification

Alternatives considered:
- Leave the fixtures unchanged: retains two reproduced failures and incomplete propagation proof.
- Delete the successful execution cases: loses distinct adapter ledger and execution-context propagation checks.
- Install approval bindings beside mocked catalogs: retains parallel registration authority.
- Reuse canonical disposable registration and existing provider support where compatible.

Migration and retirement: Reopen task-generated-1ea0c77f72276d04 through its existing proposal identity. Migrate the two independent token-budget fixtures to canonical registerTool registrations, removing replaced catalog, effect and executeTool mocks and unused declarations. Preserve controlled provider responses and exact disposal. Keep the completed permission/scaffold migration and production authorization behavior intact. Link this follow-up to the archived rollout token-budget task. No production module dependency additions or shared abstraction are indicated.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Resolve both recorded failures. Verify successful dispatch carries the same ledger, session, cwd and workflow context; exhausted budgets stop before execution; missing usage remains explicit; usage totals remain correct. Run both suites, affected helper consumers, core registration-drift checks and pnpm check:fast. Report worker or environment failures separately. The scratch probe passed eight checks but is not a finished implementation or live-model proof.

Show catalog entries, effects and approval bindings derive from one disposable registration lifecycle in both migrated fixtures. Remove obsolete simulated registry paths and unused mocks. Preserve distinct adapter outcomes while retiring only demonstrably redundant assertions.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

## Completion evidence

Migrated both `gemini-agent-harness/adapter-token-budget.test.ts` and
`openai-tools-agent-harness/adapter-token-budget.test.ts`. Gemini now consumes
its existing `adapter-test-support.ts` provider stream and disposable echo-tool
registration. OpenAI keeps its variable-usage provider stub and registers its
typed fixture runner with `registerTool`, disposing that registration after
each case. Both catalog entries, read-only effects and approval bindings now
come from the canonical registration lifecycle. Removed both core-tools module
mocks and the obsolete catalog, effect and executeTool mock declarations;
Gemini also retires its duplicated provider setup, tool declaration and stream
helper. No production authorization or shared helper implementation changed.

The isolated baseline reproduced two failed dispatch cases and six passes.
After migration, both suites pass all eight cases, including explicit ledger
identity and single-dispatch assertions, session/cwd/workflow propagation,
pre-execution budget exhaustion, unknown usage and cumulative totals.
The broader owner selection (both adapter directories plus core tools/index
and local-tool-approval-binding suites) passes 105 tests in 17 files, covering
existing helper consumers, scaffold execution, registration lifetime and
approval declaration/effect drift. No worker errors occurred in this selection.
`pnpm check:fast` passes production/test typechecking, lint, task validation,
generated client bindings and bundled module admission. The initial import-order
lint error was corrected with Biome; the complete gate then passed.
`git diff --check` also passes for the changed source and task surfaces.

This completes the fixture follow-up to
[rollout token budgets](task-add-rollout-token-budgets-to-workflow-agent-runs.md).
Provider responses remain controlled; these results are deterministic adapter
proof, not live-model evidence or measured future maintenance savings.
