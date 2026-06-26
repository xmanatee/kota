---
id: task-make-openai-compatible-model-clients-honor-model-s
title: Make OpenAI-compatible model clients honor model-specific capabilities
status: ready
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-openrouter-model-capability-catalog-and-candid]
summary: Teach the OpenAI-compatible client to send and parse OpenRouter/local model features such as reasoning, tool choice, parallel calls, structured output, multimodal blocks, usage, and provider routing without silent drops.
created_at: 2026-06-25T14:22:47.075Z
updated_at: 2026-06-26T07:19:27.140Z
---

## Problem

The OpenAI-compatible model client currently sends a minimal chat-completions
body and parses only text, tool calls, and basic usage. That is not enough for
current OpenRouter models. GLM-5.2, Kimi K2.7, DeepSeek V4, Qwen 3.7, and
others expose model-specific combinations of `reasoning`, `include_reasoning`,
`tool_choice`, `parallel_tool_calls`, `response_format`,
`structured_outputs`, multimodal inputs, max output limits, and cache/usage
metadata.

If KOTA keeps treating every OpenAI-compatible endpoint the same, it will
silently underuse strong models and misconfigure mandatory-reasoning models.

## Desired Outcome

The OpenAI-compatible provider boundary becomes model-aware. It builds request
bodies from the resolved model capability metadata, validates unsupported
effort/feature combinations before calling the provider, parses provider
reasoning and tool-call streams correctly, and records usage/cost inputs for
later model-matrix comparison.

## Constraints

- Provider wire shapes belong in `src/modules/model-clients/openai` or adjacent
  model-client modules, not in core agent harness code.
- Keep `AgentEffort` as the KOTA-facing reasoning control; map it to provider
  fields using model-aware capability metadata.
- Do not silently downgrade `max`, `xhigh`, or mandatory reasoning. Reject
  unsupported combinations with an error naming the model and supported values.
- Preserve local-provider compatibility for Ollama, LM Studio, vLLM, and custom
  `--base-url` endpoints that do not expose OpenRouter metadata.
- Do not expose private reasoning to agent prompts. Reasoning deltas may be
  operator artifacts or bounded `thinking` frames according to evidence policy.

## Done When

- Request bodies can include `tool_choice`, `parallel_tool_calls`,
  `response_format`, `structured_outputs`, `include_reasoning`, provider
  routing, and model-aware reasoning controls when the model supports them.
- Stream parsing handles tool-call ids, names, and arguments arriving across
  separate chunks, plus reasoning deltas and usage chunks.
- Non-stream `create` parsing reaches feature parity with stream parsing for
  tool calls, reasoning metadata, finish reasons, and usage.
- Tests cover GLM-5.2, Kimi K2.7 Code, DeepSeek V4 Pro/Flash, Qwen 3.7, and a
  generic local OpenAI-compatible endpoint with no capability metadata.

## Source / Intent

The research found that the most promising replacement models all rely on
capability-specific settings: GLM-5.2 supports only `high/xhigh` reasoning,
Kimi K2.7 Code has mandatory thinking and `parallel_tool_calls`, Step 3.7 has
mandatory reasoning with `low/medium/high`, and some cheaper candidates expose
tool calling without structured outputs. KOTA must reflect those differences
instead of sending one generic OpenAI request shape.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/model-clients/openai/client.test.ts src/modules/model-clients/openai/translations.test.ts src/modules/model-clients/openai-model-client.test.ts` passes.
- Snapshot or fixture tests show exact request bodies for GLM-5.2, Kimi K2.7
  Code, DeepSeek V4, Qwen 3.7, and local no-metadata routes.
- A stream parser regression test covers late tool-call names and reasoning
  deltas in the same response.
