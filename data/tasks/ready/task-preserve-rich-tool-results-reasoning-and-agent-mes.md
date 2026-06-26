---
id: task-preserve-rich-tool-results-reasoning-and-agent-mes
title: Preserve rich tool results reasoning and agent-message traces in openai-tools
status: ready
priority: p1
area: modules
task_class: Platform
depends_on: [task-make-openai-compatible-model-clients-honor-model-s, task-route-openai-tools-through-the-kota-tool-runner-wi]
summary: Make the openai-tools harness preserve rich tool results, reasoning frames, and structured action traces so model-client harnesses have inspectable parity with native harness artifacts.
created_at: 2026-06-25T14:23:05.303Z
updated_at: 2026-06-26T09:40:00.169Z
---

## Problem

The OpenAI-compatible translation layer rejects enriched tool results such as
`structuredContent`, `_meta`, MCP resource content, annotations, and images.
The `openai-tools` harness also does not emit structured
`KotaAgentMessage` frames, so harness-parity artifacts cannot inspect its
tool trajectory the way they can inspect adapters with message streams.

For strong OpenRouter models this loses context and observability. For weaker
models it is worse: missing structured results and weak traces make it hard to
diagnose why the model failed or to build targeted scaffolding.

## Desired Outcome

OpenAI-compatible model-client harnesses preserve KOTA rich-result semantics
internally and project bounded, provider-compatible text back to the model.
They emit structured text, thinking, tool-call, tool-result, status, and result
frames through `onMessage`, with private/provider payloads redacted according
to evidence policy.

## Constraints

- Do not erase rich tool data just because the provider only accepts text tool
  results. Preserve full KOTA artifacts internally and send a bounded model
  projection.
- Do not leak secrets, raw provider payloads, private reasoning, or tool I/O
  beyond the evidence policy's allowed projection target.
- Do not make `thinking` a second reasoning-control surface. The provider
  client parses reasoning; the harness emits bounded frames and artifacts.
- Multimodal tool results must degrade explicitly when a target model cannot
  consume images or MCP resources directly.
- Keep harness-parity scoring separate from eval-harness scoring.

## Done When

- Enriched KOTA tool results can pass through `openai-tools` without throwing.
- The model receives a deterministic, bounded textual projection for
  structured, MCP, image, and annotated tool results.
- `openai-tools` declares and honors `emitsAgentMessageStream: true`.
- Harness-parity trajectory artifacts include OpenAI-compatible text,
  reasoning, tool-call, tool-result, status, and result frames.
- Reasoning and raw provider payloads are redacted or omitted according to the
  existing evidence policy.

## Source / Intent

The owner asked whether OpenRouter/local routes would have full feature
parity. The audit found that rich tool results and trace frames are a concrete
parity gap today, separate from model intelligence. This task makes failures
inspectable and preserves information that weaker models need to recover.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/model-clients/openai/translations.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts src/modules/harness-parity/trajectory-diagnostics.test.ts` passes.
- A harness-parity run artifact for an `openai-tools` scenario includes
  structured trajectory frames instead of `status: "unsupported"`.
- A regression test proves `structuredContent`, `_meta`, MCP resource content,
  and image blocks produce model projections without losing internal artifact
  fidelity.
