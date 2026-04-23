---
id: task-make-autonomy-agent-steps-and-judges-harness-neutr
title: Make autonomy agent steps and judges harness-neutral
status: done
priority: p2
area: architecture
summary: Route workflow agent steps and autonomy judges through the harness registry without claude-specific mcpServers/settingSources so operators can switch defaultAgentHarness to openai-tools without silent breakage.
created_at: 2026-04-23T01:39:52.033Z
updated_at: 2026-04-23T02:13:21.923Z
---

## Problem

The `AgentHarness` registry exists to let operators run KOTA under any registered
adapter via `KotaConfig.defaultAgentHarness`, and the CLI boundary is already
harness-neutral (shared `@path` preprocessor, harness-aware chrome). But the
two load-bearing *agent-step* sites in the runtime still hard-code Claude Agent
SDK primitives:

- `src/core/workflow/steps/step-executor-agent.ts` always injects
  `mcpServers: createOwnerQuestionMcpServers(...)`, `settingSources: step.settingSources`,
  and a Claude-SDK `canUseTool` composition (`createDaemonHostControlGuard`,
  `createAgentCommitGuard`) into every `runAgentHarness` call. It dispatches
  through the registry but then passes fields the `openai-tools` adapter
  rejects loudly — the adapter's documented rejection list names exactly
  `mcpServers` and non-`bypass` `permissionMode` / `settingSources`. An
  operator who sets `defaultAgentHarness: "openai-tools"` breaks every
  autonomy agent step at the adapter boundary, and there is no test covering
  that configuration.
- `src/modules/autonomy/critic.ts`'s `invokeAgentJudge` calls
  `executeWithAgentSDK` directly, bypassing the registry entirely. Every
  judge (critic, improver semantic gate, and any future repair-loop judge)
  therefore runs on claude-agent-sdk regardless of the operator's configured
  harness — a silent pin the operator cannot see.

`src/core/agent-sdk/AGENTS.md` already states "nothing else in core should
import `executeWithAgentSDK` directly" and "other adapters do not depend on
it", but `step-executor-agent.ts`, `repair-loop.ts`, `autonomy/critic.ts`, and
several tests import it as a first-party runtime primitive. The invariant the
doc asserts is not enforced in code. Together these pin the "general-purpose
coding agent across pluggable harnesses" claim to claude-agent-sdk in the
two places autonomy actually runs.

## Desired Outcome

Autonomy's agent steps and judges dispatch through the neutral harness registry
with no claude-agent-sdk-specific option leaking through. Specifically:

- Owner-questions access is exposed to every harness through a mechanism the
  `AgentHarness` protocol owns — not as a Claude-SDK MCP server injected at
  the step-executor layer. The concrete shape (harness-neutral tool, adapter-
  declared capability + conditional injection, or built-in harness feature)
  is a design choice; the outcome is that switching harness does not
  silently remove the owner-questions surface and does not cause the openai-
  tools adapter to throw.
- `step-executor-agent.ts` and `autonomy/critic.ts` call `runAgentHarness(...)`
  only. Claude-SDK-specific fields (`mcpServers`, `settingSources`,
  `persistSession`, `canUseTool` built from SDK guards) live inside the
  claude-agent-harness module or behind an adapter-declared capability gate.
- A focused test runs a representative autonomy agent step and an autonomy
  judge against a stubbed `openai-tools` adapter end-to-end, proving neither
  path raises the adapter's `mcpServers` / `settingSources` rejection.
- `src/core/agent-sdk/AGENTS.md` matches the code: the invariant it asserts
  ("nothing else in core imports `executeWithAgentSDK` directly") is either
  true because imports moved into the claude-agent-harness module, or the
  doc is updated to reflect the real boundary. One source of truth.

## Constraints

- Do not add a parallel "capability matrix" module under
  `src/core/agent-harness/`. Adapters already expose capability via their
  own declarations (`supportsMultiTurn`, `supportedHookKinds`, rejection
  lists); extend that surface rather than inventing a second registry.
- Do not teach `step-executor-agent.ts` to branch on harness name. Capability
  belongs to the adapter; the step executor composes harness-neutral options
  and lets the adapter honor or reject them. Name-based branching is the
  hidden coupling this task exists to remove.
- Owner-questions delivery must not silently degrade when an operator
  switches harness. If a harness cannot host the owner-questions mechanism,
  it must fail loudly at the boundary (per `AgentHarness` protocol rules),
  not run with owner-questions disabled.
- Autonomy judges (`invokeAgentJudge`, improver semantic gate) must route
  through `runAgentHarness`. Their judge-wrapper contract (repair checks
  catch runaway throws and return warnings; unclassified SDK failures still
  reject the check — see `src/modules/autonomy/AGENTS.md`) continues to apply
  and must be extended if the wrapper shape changes.
- No dual path. Either every agent step and every judge flows through the
  registry, or the remaining exception is named explicitly in the code with
  a failing test if it regresses. No "permissive mode" flag.
- Do not silently drop `persistSession`, `settingSources`, or per-step
  `permissionMode` fields that today reach the claude adapter. Either they
  live on an adapter-declared option surface or they are rejected loudly at
  the step-validator boundary when an incompatible harness is resolved.
- Keep the test boundary stubbed. Use a fake ModelClient / adapter stub —
  no live endpoint, no real API budget — consistent with
  `openai-tools-agent-harness/adapter.integration.test.ts`.
- This is scoped to *autonomy agent steps and judges*. The classic
  interactive session loop (`src/core/loop/`) and the architect module's
  classic-loop pre-send hooks are separately scoped and out of scope here.

## Done When

- Autonomy agent steps in `src/core/workflow/steps/step-executor-agent.ts`
  reach every registered adapter via `runAgentHarness(...)` without passing
  claude-agent-sdk-specific options that the openai-tools adapter rejects
  (`mcpServers`, non-`bypass` `permissionMode`, `settingSources`).
- `src/modules/autonomy/critic.ts`'s `invokeAgentJudge` (and any other
  judge entry point, e.g. improver semantic gate) dispatches through the
  harness registry. `executeWithAgentSDK` is no longer imported from
  `src/modules/autonomy/` or from any non-claude-adapter core path.
- Owner-questions access is exposed to every harness through the
  `AgentHarness` protocol rather than injected at the step layer. The
  concrete mechanism is documented at `src/core/agent-harness/AGENTS.md`
  and/or the relevant module's `AGENTS.md` at conventions level.
- A focused test runs a real workflow agent step and an autonomy judge
  against a stubbed `openai-tools` adapter (fake ModelClient) and asserts
  neither path throws the adapter's claude-specific rejection. The test
  lives in the adapter's `*.integration.test.ts` or a sibling test in the
  step-executor / critic tree.
- `src/core/agent-sdk/AGENTS.md` is either true as written (no non-claude-
  adapter imports of `executeWithAgentSDK`) or updated to describe the real
  boundary. The `src/core/AGENTS.md` + `src/core/agent-harness/AGENTS.md`
  story stays internally consistent after the change.
- No new module is introduced just to hold the neutral composition. Existing
  homes (`src/core/agent-harness/`, `src/core/agent-sdk/` → `src/modules/claude-agent-harness/`,
  `src/core/workflow/steps/`) absorb the moved code.
