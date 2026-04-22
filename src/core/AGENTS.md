# Core

This directory contains KOTA's kernel: the runtime substrate that modules plug
into.

- Keep `src/core/` small and protocol-oriented.
- Core owns the agent/session loop, workflow runtime, daemon runtime, event
  bus, tool runtime, and module lifecycle.
- General-purpose product capabilities should prefer `src/modules/` unless they
  are truly shared runtime primitives.
- Do not add operator-facing feature code here when it can live in a module.

## Subtrees

- `agents/` — core agent and skill definition types plus system-prompt
  primitives.
- `channels/` — core channel protocol types.
- `config/` — configuration schema, layered loading, secrets management, and
  secret providers.
- `daemon/` — daemon host, control API, scheduler persistence, and live runtime
  state.
- `events/` — typed event catalog and event bus.
- `loop/` — `AgentSession`, turn execution, context assembly, transport,
  dynamic state, and module-contributed pre-send hooks that run once before
  the main turn loop.
- `model/` — `ModelClient` interface, registry, adaptive routing, and streaming.
  Provider implementations live in `src/modules/model-clients/`.
- `modules/` — module protocol, discovery, loading, lifecycle, storage, and
  foreign-module support.
- `tools/` — core tool runtime and the remaining truly core-hosted tools.
- `workflow/` — workflow definitions, validation, execution, runtime, and
  repair-loop mechanics.
- `agent-sdk/` — Claude Agent SDK executor, system-prompt builder, and SDK
  type re-exports. Internal implementation detail of the
  `claude-agent-harness` module; nothing else in core should call
  `executeWithAgentSDK` directly.
- `agent-harness/` — neutral `AgentHarness` protocol and registry. Workflow
  agent steps, the repair loop, the agent-harness delegate backend, and the
  CLI all dispatch through this registry. Adapters (claude-agent-sdk, thin,
  any future codex / OpenAI-compat loop) ship as modules and register on
  load. There is no implicit default — operators select with
  `KotaConfig.defaultAgentHarness` or per-step `harness`, and the runtime
  fails loudly when neither is set.
- `prompt-input/` — harness-neutral user-prompt preprocessing
  (`@path` reference expansion). Every CLI path calls it before handing a
  prompt to `AgentHarness.run`, so every adapter receives the same
  already-expanded text.
- New non-test source should land in `src/core/<subtree>/` or `src/modules/<name>/`,
  not as another loose `src/*.ts` file.
