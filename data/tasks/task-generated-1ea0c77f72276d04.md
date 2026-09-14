---
status: open
priority: p2
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
