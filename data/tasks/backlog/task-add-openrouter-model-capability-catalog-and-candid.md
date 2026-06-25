---
id: task-add-openrouter-model-capability-catalog-and-candid
title: Add OpenRouter model capability catalog and candidate presets
status: backlog
priority: p1
area: core
task_class: Platform
summary: Record live OpenRouter model capabilities and add candidate presets for GLM, Kimi, DeepSeek, Qwen, MiniMax, MiMo, Nemotron, Step, Ring, KAT, Poolside, Hy3, and local OpenAI-compatible routes.
created_at: 2026-06-25T14:22:41.268Z
updated_at: 2026-06-25T14:22:41.268Z
---

## Problem

KOTA's shipped OpenRouter preset does not reflect the current model landscape.
It routes `fast`, `balanced`, and `capable` to `openrouter/openai/gpt-4.1-mini`
and does not record per-model capabilities such as mandatory reasoning,
supported effort levels, `parallel_tool_calls`, structured output, context
length, max output, modality support, or price.

The owner specifically called out newer GLM models and asked for all other
relevant OpenRouter/local options to be considered. Without a capability
catalog, later harness work will keep guessing at provider behavior.

## Desired Outcome

KOTA has a model capability catalog and candidate preset set for current
OpenRouter and local OpenAI-compatible models. The catalog records observed
metadata from OpenRouter `/models` with an `observedAt` timestamp and feeds
model-aware request validation, preset selection, parity matrix selection, and
rollout reporting.

## Constraints

- Do not replace the default KOTA/Codex route in this task.
- Do not use `openrouter/auto` as evidence for a model-specific capability
  claim; candidate entries must name concrete model ids.
- Include at least these OpenRouter candidates: `z-ai/glm-5.2`,
  `moonshotai/kimi-k2.7-code`, `deepseek/deepseek-v4-pro`,
  `deepseek/deepseek-v4-flash`, `qwen/qwen3.7-plus`, `qwen/qwen3.7-max`,
  `minimax/minimax-m3`, `xiaomi/mimo-v2.5`, `xiaomi/mimo-v2.5-pro`,
  `cohere/north-mini-code:free`, `nvidia/nemotron-3-ultra-550b-a55b`,
  `stepfun/step-3.7-flash`, `inclusionai/ring-2.6-1t`,
  `kwaipilot/kat-coder-pro-v2`, `poolside/laguna-m.1`, and
  `tencent/hy3-preview`.
- Include direct-provider route decisions for Z.ai and Kimi only if the owning
  model-client boundary can express them without a parallel provider system.
- Keep durable docs concise. Store catalog truth in typed config/data used by
  code and tests, not in a prose link list.

## Done When

- KOTA can resolve a named OpenRouter candidate set with per-model context,
  max output, pricing, tool support, structured-output support, reasoning
  support, reasoning effort levels, mandatory reasoning, parallel tool-call
  support, and modality support.
- A non-default `openrouter-lab` or equivalent preset exists with
  `fast=deepseek/deepseek-v4-flash`, `balanced=qwen/qwen3.7-plus`, and
  `capable=z-ai/glm-5.2`, plus separately selectable named candidates for the
  rest of the matrix.
- Local OpenAI-compatible routes remain explicit through `ollama`, `lmstudio`,
  or configured `--base-url`; the catalog does not pretend unknown local
  models have OpenRouter metadata.
- Missing or stale capability data fails loudly at the boundary that needs it.

## Source / Intent

Owner asked to revisit the latest GLM and "all other models" rather than
assuming the prior OpenRouter path was sufficient. Live OpenRouter metadata on
June 25, 2026 showed `z-ai/glm-5.2` as the latest GLM route with 1M context,
tool calling, structured outputs, and `high/xhigh` reasoning; it also surfaced
Kimi K2.7 Code, DeepSeek V4, Qwen 3.7, MiniMax M3, MiMo V2.5, North Mini Code,
Nemotron 3 Ultra, Step 3.7, Ring 2.6, KAT Coder, Poolside Laguna, and Hy3 as
relevant tool-capable candidates.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm run test:preset-parity` passes or records valid auth/runtime skips.
- A focused test proves every shipped OpenRouter candidate resolves through the
  catalog with explicit capability metadata.
- A captured dry-run artifact under `.kota/runs/<run-id>/` records the
  observed OpenRouter model metadata date and candidate list without exposing
  API keys.
