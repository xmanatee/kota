---
status: done
---
# Restore hosted harness permission and scaffold checks through real tool registration

## Problem

Gemini, Vercel and OpenAI scaffold fixtures simulate tool catalogs and execution without installing canonical registration bindings. The shared runner rejects their calls before authorization, causing 13 reproduced failures and leaving approval, execution-context, masking and scaffold verification assertions unable to exercise their intended boundaries.

Investigation: Assessed 6b7955e71b980a5e4c36d653. The duplicated catalog filter is consistent across maintained adapters and does not justify extraction. Investigation exposed a concrete maintenance problem in their verification: mocked tool catalogs bypass canonical registration, so current authorization rejects their calls before the intended behavior is exercised. Selected tests produced 30 passes and 13 failures across Gemini/Vercel permission and OpenAI scaffold scenarios. A real-registration probe passed Gemini/OpenAI dispatch and deny-list enforcement. Migrate these fixtures to the existing registration owner; no production authorization defect or measured improvement is claimed. Active blocked evaluation tasks do not cover this deterministic repair. No supplied delivery issue has an established causal link. The other 17 structural leads remain unassessed. No tracked files were edited.

Evidence:
- 6b7955e71b980a5e4c36d653
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- src/modules/gemini-agent-harness/tool-loop.ts
- src/modules/gemini-agent-harness/adapter-test-support.ts
- src/modules/gemini-agent-harness/adapter-permission-policy.test.ts
- src/modules/vercel-agent-harness/adapter-tools.ts
- src/modules/vercel-agent-harness/adapter-test-support.ts
- src/modules/vercel-agent-harness/adapter-guardrails.test.ts
- src/modules/openai-tools-agent-harness/tool-loop.ts
- src/modules/openai-tools-agent-harness/scaffold-tool-definitions.ts
- src/modules/openai-tools-agent-harness/adapter-shared-runner-test-support.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold-test-support.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold.test.ts
- src/modules/openai-tools-agent-harness/adapter-scaffold-verification.test.ts
- src/core/agent-harness/tool-execution-options.ts
- src/core/tools/tool-registry.ts
- src/core/tools/local-tool-approval-binding.ts
- src/core/tools/tool-runner-execute-block.ts
- src/core/tools/tool-runner-permission.test.ts
- data/tasks/archive/task-security-review-local-tool-approvals-bind-the-revi.md
- data/tasks/archive/task-security-review-the-gemini-and-vercel-kota-hosted-.md
- data/tasks/archive/task-add-scaffolded-weak-and-local-model-agent-mode.md
- data/tasks/task-capture-an-end-to-end-coding-task-parity-artifact-.md
- data/tasks/task-run-live-openrouter-and-local-model-rollout-evalua.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-19-43-421z-archite-f25acccba92047e6aa5c0914e6f9ada16c4ceeb0e1342ca73a74755e413da10b/agent/harness-registration-review.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-19-43-421z-archite-f25acccba92047e6aa5c0914e6f9ada16c4ceeb0e1342ca73a74755e413da10b/agent/tool-registration-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t07-19-43-421z-archite-f25acccba92047e6aa5c0914e6f9ada16c4ceeb0e1342ca73a74755e413da10b/agent/tool-registration-probe.json

## Desired Outcome

Adapter verification exercises real registration and permissioned execution while retaining controlled provider responses. Removing simulated registry ownership is expected to reduce fixture drift and restore useful regression feedback; that benefit remains unmeasured.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Gemini adapter permission-policy fixtures
- Vercel adapter guardrail and execution fixtures
- OpenAI shared-runner and scaffold edit/verify fixtures

Alternatives considered:
- Leave the production catalog filters local: their consistent behavior and different catalog sources do not establish a worthwhile extraction.
- Leave the failing fixtures unchanged: rejected because their intended security and scaffold outcomes are not exercised.
- Delete all affected checks: rejected because distinct adapter translation and scaffold verification behavior still needs proof.
- Simulate registration leases in another mock layer: rejected because it adds parallel authority and can conceal registration drift.
- Use existing disposable tool registration and retain only checks with distinct consumer outcomes.

Migration and retirement: Replace affected catalog, runner and effect simulations with disposable registerTool registrations carrying representative schemas, effects and runners. Keep provider/network doubles at external boundaries. Trace consumers of the changed support helpers and migrate them together. Exercise real temporary-file editing and verification in the scaffold journey. Retire redundant generic runner assertions where core already owns equivalent proof, preserving adapter-specific propagation checks. Link the repair to the archived registration-binding, Gemini/Vercel guardrail and scaffold tasks as follow-up verification evidence. Keep blocked live-model evaluation contracts with their existing owners.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Reproduce and resolve the recorded failures. Demonstrate catalog allow/deny behavior, adapter denial translation, confirmation and scoped approval propagation, and execution results through real registrations. Preserve core registration-drift rejection. Show a scaffold edit changes a temporary file, omitted verification rejects completion after a successful edit, and failed verifier output reaches the next controlled model turn. Run affected helper consumers and pnpm check:fast; report environmental limitations and do not claim live model parity.

Show the affected fixtures obtain catalog entries, effect metadata and authorization bindings from the existing registration lifecycle, with proper disposal. Remove replaced simulated registry paths and identify redundant checks retired without losing distinct behavior coverage. Passing tests alone do not establish reduced ownership duplication.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.

## Completion evidence

Restored the affected deterministic verification through disposable `registerTool`
registrations. Production catalog filtering, authorization and execution code are
unchanged. Catalog entries, effects and approval bindings now come from the same
registration lifecycle; each fixture disposes only its own registrations.

Migrated helper consumers (paths are relative to `src/modules/`):
- `gemini-agent-harness/`: `adapter.test.ts`, `adapter-options.test.ts`,
  `adapter-guardrails.test.ts`, `adapter-permission-policy.test.ts`,
  `adapter-tool-loop.test.ts`, and `adapter-session-resume.test.ts`.
- `vercel-agent-harness/`: `adapter.test.ts`, `adapter-options.test.ts`, and
  `adapter-guardrails.test.ts` (including `adapter-tool-test-support.ts`).
- `openai-tools-agent-harness/`: `adapter-shared-runner.test.ts`,
  `adapter-approval-shared-runner.test.ts`, `adapter-mcp-shared-runner.test.ts`,
  `adapter-session-resume.test.ts`, `adapter-scaffold.test.ts`, and
  `adapter-scaffold-verification.test.ts`.

Removed the four affected `#core/tools/index.js` mock blocks and their simulated
catalog/effect accessors. Registered fixture runners now receive real permissioned
dispatch; they no longer replace `executeTool`. Gemini permission checks reuse the
existing provider fixture. OpenAI resume checks no longer maintain both a mocked
catalog and a separate binding. Scaffold setup consumes production module tool
definitions, filesystem runners and effects, and replaces its name-switch execution
mock with registrations. The Node verifier uses fixed argv against actual temporary
files. The shared legacy MCP peer now rejects unsupported discovery correctly,
restoring two additional failures found while checking helper consumers.

Retired the OpenAI adapter's redundant default-guardrails-policy case, owned by
`src/core/tools/tool-runner-permission.test.ts`. Explicit policy propagation and
adapter response translation remain covered. Replaced the scaffold's private runner
call-order assertion with observed file content and verifier failure/success. Other
adapter-specific confirmation, queue/client approval, execution context, masking,
catalog and continuation assertions remain.

Validation in builder run `2026-09-14T07-27-36-680Z-builder-tfszpt`:
- Reproduced all 13 reported failures across the four original permission/scaffold
  suites before editing (5 other checks passed).
- Final affected-consumer selection plus core permission and local approval-binding
  tests: **17 suites, 80 checks passed**. This covers catalog allow/deny and a
  hallucinated hidden Gemini call, denial translation, scoped queue/session and
  approval-binding propagation, confirmation/client approval, execution results,
  masking, persisted sessions, MCP dispatch and registration-drift rejection.
- Scaffold verification fails against the original arithmetic fixture, edits its
  temporary file through the registered filesystem runner and passes the same real
  Node verifier afterward. Separate cases prove a successful edit without verification
  rejects completion and failed verifier output reaches the next controlled model turn.
- `pnpm check:fast` passed on the final changeset, covering production/test types,
  lint, task validity, generated client bindings and admission of 90 bundled modules.

Commands and final deterministic output are retained in the run's
`agent/affected-tests-final.log`; final static-gate output is retained in
`agent/check-fast-final.log`. The source diff establishes removal of duplicate
fixture authority; passing tests alone do not establish a measured reduction in
future drift or maintenance effort.

The production `runShell` attempt encountered `sandbox-exec: sandbox_apply:
Operation not permitted` inside this macOS agent sandbox. The retained adapter
fixture instead runs its known Node verifier with fixed argv within the available
execution sandbox. This proves real edit/verify sequencing without claiming proof
of the production shell sandbox. Real Git diff runs against a non-repository
fixture report that absence; verifier success remains the scaffold's completion
criterion. No live model parity, deployment outcome or production authorization
improvement is claimed. Blocked live-model evaluation tasks retain their owners.

This is follow-up verification for
[local approval binding](task-security-review-local-tool-approvals-bind-the-revi.md),
[Gemini/Vercel guardrails](task-security-review-the-gemini-and-vercel-kota-hosted-.md),
and [scaffold mode](task-add-scaffolded-weak-and-local-model-agent-mode.md).
