---
id: task-security-review-openai-compatible-provider-reasoni
title: Security review: OpenAI-compatible provider reasoning is captured as transcript `thinking` content and later included in the compaction prompt, exposing provider-private reasoning to future model calls.
status: ready
priority: p2
area: security
summary: OpenAI-compatible provider reasoning is captured as transcript `thinking` content and later included in the compaction prompt, exposing provider-private reasoning to future model calls.
created_at: 2026-06-26T09:05:35.242Z
updated_at: 2026-06-26T09:05:35.242Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/model-clients/openai/stream.ts
claim:

> OpenAI-compatible provider reasoning is captured as transcript `thinking` content and later included in the compaction prompt, exposing provider-private reasoning to future model calls.

## Desired Outcome

> Do not map OpenAI/OpenRouter `reasoning` or `reasoning_content` into promptable transcript `thinking` blocks. Store it only as redacted/operator-local metadata, or tag it as non-promptable and update compaction and provider adapters to drop it. Add a regression test proving OpenAI-compatible reasoning never appears in compaction prompts.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-26T08-24-23-034Z-security-review-r3hv8z.

finding id: openai-reasoning-compaction-leak
candidate id: mcp-transport:src/modules/model-clients/openai/stream.ts:2
verdict: confirmed
rationale:

> Confirmed. OpenAI-compatible stream parsing appends response.reasoning.delta and delta.reasoning/reasoning_content into `thinking` in src/modules/model-clients/openai/stream.ts, and non-stream create parsing does the same via extractReasoningText in src/modules/model-clients/openai/client.ts. buildKotaModelResponse serializes that data as a transcript `thinking` block, AgentContext.addAssistantMessage persists message.content, and compactMessages selects assistant thinking blocks for `conversationText` before sending it to client.messages.create and preserving it in the compacted assistant-rationale section.

Evidence:

Evidence 1:



path: src/modules/model-clients/openai/stream.ts

line: 89

excerpt:



> if (isReasoningDeltaEvent(parsed)) { thinking += parsed.delta; this.emit("thinking", parsed.delta);

Evidence 2:



path: src/modules/model-clients/openai/stream.ts

line: 148

excerpt:



> return buildKotaModelResponse({ text, ...(thinking ? { thinking } : {}),

Evidence 3:



path: src/modules/model-clients/openai/translations.ts

line: 219

excerpt:



> content.push({ type: "thinking", thinking: opts.thinking, signature: "" });

Evidence 4:



path: src/core/loop/context.ts

line: 98

excerpt:



> addAssistantMessage(message: KotaModelResponse): void { this.messages.push({ role: "assistant", content: message.content });

Evidence 5:



path: src/core/loop/compaction.ts

line: 286

excerpt:



> if (block.type === "thinking") { ... parts.push(`[assistant thinking/rationale] ${thinking}`);

Evidence 6:



path: src/core/loop/compaction.ts

line: 349

excerpt:



> client.messages.create({ model, max_tokens: 1024, system: COMPACTION_PROMPT, messages: [{ role: "user", content: conversationText }] });

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
