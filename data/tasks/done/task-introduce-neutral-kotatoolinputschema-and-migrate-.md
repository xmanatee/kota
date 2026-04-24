---
id: task-introduce-neutral-kotatoolinputschema-and-migrate-
title: Introduce neutral KotaToolInputSchema and migrate core tool-schema builders
status: done
priority: p1
area: architecture
summary: Stage 1 of the neutral message-protocol plan in src/core/agent-harness/anthropic-type-audit.md: introduce KotaToolInputSchema in src/core/agent-harness/types.ts and migrate the five core tool-schema builders so the input_schema role no longer reads as Anthropic.Tool.InputSchema.
created_at: 2026-04-24T04:14:50.974Z
updated_at: 2026-04-24T04:20:11.940Z
---

## Problem

`src/core/agent-harness/anthropic-type-audit.md` lays out a six-stage plan
to make core's internal message protocol harness-neutral so that
`src/core/` stops treating Anthropic's SDK type surface as its canonical
contract. Stage 1 — `KotaToolInputSchema` — is the cheapest and most
independent stage and the prerequisite for Stage 2 (`KotaTool`). Today
the JSON Schema shape reaches into core through five files
(`tool-adapters-zod.ts`, `custom-tool.ts`, `custom-tool-handlers.ts`,
`manifest/execution.ts`, `modules/foreign-module.ts`) under the name
`Anthropic.Tool.InputSchema`. Because `KotaToolInputSchema` is
structurally compatible with `Anthropic.Tool.InputSchema`, this stage
lands without any adapter-side rewrites — it is a pure rename of the
contract, not a behavior change.

## Desired Outcome

- `KotaToolInputSchema` exists in `src/core/agent-harness/types.ts`
  (or a co-located `message-protocol.ts` if `types.ts` is at its size
  budget) as the neutral JSON Schema object shape: `{ type: "object";
  properties: Record<string, unknown>; required?: string[]; ... }`.
- `src/core/tools/tool-adapters-zod.ts`'s `buildInputSchema` returns
  `KotaToolInputSchema`.
- `src/core/tools/custom-tool.ts` and
  `src/core/tools/custom-tool-handlers.ts` reference
  `KotaToolInputSchema` everywhere their dynamic-tool registration seam
  used to cast to `Anthropic.Tool.InputSchema`.
- `src/core/manifest/execution.ts` casts `t.parameters` to
  `KotaToolInputSchema` when building a `ToolDef` from a manifest.
- `src/core/modules/foreign-module.ts` types
  `KempManifest.tools[].input_schema` as `KotaToolInputSchema`. The
  on-the-wire JSON Schema payload does not change.
- After this stage, the named files no longer reference
  `Anthropic.Tool.InputSchema`. They retain their `type Anthropic`
  import only if they still reference `Anthropic.Tool` — Stage 2 removes
  that.

## Constraints

- Single cohesive PR; tree green at every commit.
- Do not introduce a parallel input-schema type that lives beside the
  Anthropic shape indefinitely. The endpoint for the broader plan is one
  neutral protocol; this stage advances toward it.
- No adapter-side rewrites. `KotaToolInputSchema` is structurally
  compatible with `Anthropic.Tool.InputSchema` so claude-agent-harness,
  model-clients/anthropic, model-clients/openai, openai-tools-agent-
  harness, thin-agent-harness, and mcp-server pass it through unchanged.
- Do not touch the `Anthropic.Tool` (full tool definition) imports in
  the same files — that is Stage 2's scope.
- Tests, type-checks, and the existing core boundary suite must pass.

## Done When

- `KotaToolInputSchema` is defined in `src/core/agent-harness/` and
  exported from the agent-harness index.
- `src/core/tools/tool-adapters-zod.ts`,
  `src/core/tools/custom-tool.ts`,
  `src/core/tools/custom-tool-handlers.ts`,
  `src/core/manifest/execution.ts`, and
  `src/core/modules/foreign-module.ts` use `KotaToolInputSchema` instead
  of `Anthropic.Tool.InputSchema`.
- `pnpm test` passes; the audit document remains accurate (Stage 1
  marked complete in a follow-up commit if the audit tracks stage
  status, otherwise unchanged).
