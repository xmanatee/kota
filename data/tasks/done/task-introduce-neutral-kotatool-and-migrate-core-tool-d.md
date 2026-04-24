---
id: task-introduce-neutral-kotatool-and-migrate-core-tool-d
title: Introduce neutral KotaTool and migrate core tool-definition and registry
status: done
priority: p1
area: architecture
summary: Stage 2 of the neutral message-protocol plan in src/core/agent-harness/anthropic-type-audit.md. Introduce KotaTool in src/core/agent-harness/types.ts and migrate the full tool-definition / registry / MCP / manifest surface in core from Anthropic.Tool to KotaTool, flipping the five module-side adapter seams (claude-agent-harness, model-clients/anthropic, model-clients/openai, openai-tools-agent-harness, thin-agent-harness, mcp-server) to consume KotaTool inputs.
created_at: 2026-04-24T04:46:29.155Z
updated_at: 2026-04-24T05:06:42.946Z
---

## Problem

`src/core/agent-harness/anthropic-type-audit.md` decomposes the shift to a
harness-neutral core message protocol into six stages. Stage 1
(`KotaToolInputSchema`) landed in b7512824 and removed the
`Anthropic.Tool.InputSchema` name from five files, but the wider tool
contract — `Anthropic.Tool` itself — still spans 21 files under
`src/core/`. Every core tool declaration, the tool registry, the MCP
bridge, the delegate sub-agent, the manifest execution path, and the
`ToolDef` module contribution type all treat `Anthropic.Tool` as KOTA's
canonical tool shape. Until that name is neutral, modules like
`openai-tools-agent-harness`, `model-clients/openai`, and any future
codex/Gemini/local-model adapters must translate core's "neutral"
contract back through an Anthropic SDK type on every call, so the
boundary claim in `src/core/agent-harness/AGENTS.md` ("nothing in core
treats Anthropic's SDK type surface as its internal protocol") stays
aspirational rather than structural.

Stage 2 is the largest single stage in the audit but also the one that
removes role-1 (tool-definition / schema shapes) from core entirely.
`KotaTool` is structurally compatible with `Anthropic.Tool`
(`{ name: string; description: string; input_schema: KotaToolInputSchema }`)
so it passes through the claude and anthropic module seams unchanged.
The five module-side adapter seams that already own tool-shape
translation flip their declared input type to `KotaTool`; no provider
wire changes.

## Desired Outcome

- `KotaTool` exists in `src/core/agent-harness/types.ts` (or an adjacent
  `message-protocol.ts` if `types.ts` is at its size budget) as
  `{ name: string; description: string; input_schema: KotaToolInputSchema }`
  and is exported from the agent-harness index.
- Every core tool declaration uses `KotaTool`:
  `src/core/tools/{agent-status,approval,ask-owner,ask-user,checkpoint,confirm,todo}.ts`
  and `src/core/tools/module-factory/definition.ts`
  (`moduleFactoryTool: KotaTool`).
- The core tool registry consumes `KotaTool`:
  - `src/core/tools/index.ts` — `ToolRegistration.tool`, `tools`,
    `getAllTools()`, `getRegisteredTools()`, `resolveToolSet()`,
    `registerTool()` typed on `KotaTool`.
  - `src/core/tools/tool-groups.ts` — `filterTools`,
    `buildEnableToolsTool`, `enableToolsTool` typed on `KotaTool`.
  - `src/core/tools/custom-tool.ts`,
    `src/core/tools/custom-tool-handlers.ts` — `RegisterFn`,
    `customToolTool`, and internal `toolDef` typed on `KotaTool`.
- The delegate sub-agent consumes `KotaTool`:
  - `src/core/tools/delegate.ts` — `delegateTool: KotaTool`.
  - `src/core/tools/delegate-turn.ts` — `TurnLoopOptions.tools: KotaTool[]`.
  - `src/core/agents/delegate-prompts.ts` — `subShellTool: KotaTool` and
    tool-set return signatures typed on `KotaTool[]`.
- The MCP bridge produces `KotaTool`:
  - `src/core/mcp/manager.ts` — `toAnthropicTool` renamed `toKotaTool`,
    `McpManager.getTools(): KotaTool[]`, internal `kotaTools: KotaTool[]`.
- The module contribution contract and manifest path consume `KotaTool`:
  - `src/core/modules/module-types.ts` — `ToolDef.tool: KotaTool`.
  - `src/core/manifest/execution.ts` — any residual `Anthropic.Tool`
    reference removed; `ToolDef` construction uses `KotaTool`.
- The tool-registry integration test fixture (`makeTool`) returns
  `KotaTool`.
- The five module-side adapter seams flip their declared input type:
  - `src/modules/claude-agent-harness/adapter.ts` — accepts
    `KotaTool[]`; structurally compatible, no conversion required today.
  - `src/modules/model-clients/anthropic/*` — introduces an explicit
    `kotaToAnthropicTool()` helper (structurally a no-op today, but the
    boundary is the new invariant).
  - `src/modules/model-clients/openai/translations.ts` — input type for
    tool translation is `KotaTool`.
  - `src/modules/openai-tools-agent-harness`,
    `src/modules/thin-agent-harness` — same input type swap.
  - `src/modules/mcp-server` — the MCP bridge consumes `KotaTool` and
    produces MCP tool entries.
- After this stage, no file under `src/core/` references
  `Anthropic.Tool`. Files that retain a `type Anthropic` import must
  still reference `Anthropic.Message*` or `Anthropic.Messages.*`
  shapes (Stages 3–5 remove those); if a file's only remaining
  Anthropic reference was `Anthropic.Tool`, the import goes away in
  this stage.
- The audit document reflects Stage 2 completion in a follow-up commit
  if the audit tracks stage status, otherwise unchanged.

## Constraints

- Single cohesive PR; tree green at every commit.
- Do not introduce a parallel tool type that lives beside
  `Anthropic.Tool` indefinitely. The endpoint is one neutral protocol;
  this stage advances to it.
- `KotaTool` is structurally compatible with `Anthropic.Tool`. Adapters
  that currently pass the shape through (claude-agent-harness, anthropic
  model client) continue to do so; they just declare `KotaTool` on the
  input side. An explicit `kotaToAnthropicTool()` helper is introduced in
  the anthropic provider so the boundary is a call site rather than a
  pass-through cast — but it must remain a structural no-op today.
- Do not touch Anthropic message/content/thinking shapes in the same
  files. Stages 3–5 handle those. If a loop file references
  `Anthropic.Tool[]` indirectly (e.g. through `StreamConfig.tools`),
  retype the tool field to `KotaTool[]` but leave the message shapes
  alone.
- No provider wire changes. The on-the-wire JSON shape that each
  provider sends does not change.
- Tests, type-checks, and the existing core boundary suite must pass.
  Fixture churn is confined to `tool-registry.integration.test.ts` and
  any module-side adapter test that constructs tool inputs.

## Done When

- `KotaTool` is defined in `src/core/agent-harness/` and exported from
  the agent-harness index.
- No file under `src/core/` references `Anthropic.Tool`.
- The five module-side adapter seams
  (`claude-agent-harness`, `model-clients/anthropic`,
  `model-clients/openai`, `openai-tools-agent-harness`,
  `thin-agent-harness`, `mcp-server`) declare `KotaTool` inputs at the
  tool-translation call sites named above.
- `pnpm test` passes; `pnpm build` (or the repo's type-check script)
  passes; the core-boundary suite passes.
- `src/core/agent-harness/anthropic-type-audit.md` remains accurate —
  Stage 2 is no longer an open follow-up.
