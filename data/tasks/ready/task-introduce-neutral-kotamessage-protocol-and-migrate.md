---
id: task-introduce-neutral-kotamessage-protocol-and-migrate
title: Introduce neutral KotaMessage protocol and migrate core loop + delegate + history surfaces
status: ready
priority: p2
area: architecture
summary: Implement Stage 4 of the Anthropic SDK type-surface audit: add neutral KotaMessage / KotaContentBlock / KotaTextBlock / KotaToolUseBlock / KotaToolResultBlock / KotaImageBlock and migrate the core loop, compaction, masking, pruning, reflection, tool-runner, delegate, and history-provider surfaces off Anthropic message types.
created_at: 2026-04-24T05:51:05.434Z
updated_at: 2026-04-24T05:51:05.434Z
---

## Problem

`src/core/agent-harness/anthropic-type-audit.md` lays out a six-stage plan to
remove every `@anthropic-ai/sdk` type import from `src/core/`. Stages 1
(`KotaToolInputSchema`), 2 (`KotaTool`), and 3 (`KotaThinkingConfig`) have
landed. Role (1) "tool-definition / schema shapes" and role (3)
"reasoning / thinking shapes" are gone from core. The next load-bearing
Anthropic surface still referenced by core is role (2), the internal
message / content-block protocol: `Anthropic.MessageParam`,
`Anthropic.Message`, `Anthropic.Messages.ContentBlockParam`,
`Anthropic.Messages.TextBlockParam`, `Anthropic.Messages.ToolUseBlock`,
`Anthropic.Messages.ToolUseBlockParam`, and
`Anthropic.Messages.ToolResultBlockParam`.

Ten core files still import those shapes as the name of an internal
contract:

- `src/core/loop/context.ts` — `type Message = Anthropic.MessageParam`,
  `Context.addAssistantMessage(Anthropic.Message)`,
  `Anthropic.Messages.ToolResultBlockParam["content"]` on
  `addToolResults`.
- `src/core/loop/compaction.ts` — canonical `Message` / `ContentBlock`
  aliases plus casts to `Anthropic.Messages.ToolUseBlockParam` /
  `ToolResultBlockParam` / `TextBlockParam`.
- `src/core/loop/observation-masking.ts` — same canonical aliases plus
  helper signatures typed on `Anthropic.Messages.ToolResultBlockParam`.
- `src/core/loop/reflection.ts` — same canonical aliases plus block
  casts for text extraction.
- `src/core/loop/message-pruning.ts` — same canonical aliases plus
  casts for tool-use / tool-result blocks.
- `src/core/loop/loop-send.ts` — `system: Anthropic.Messages.TextBlockParam[]`
  plus an `Anthropic.Messages.ToolUseBlock` filter on assistant content.
- `src/core/loop/pre-send-hooks.ts` —
  `PreSendContext.messages: Anthropic.Messages.MessageParam[]`.
- `src/core/tools/tool-runner.ts` —
  `ToolCallExecutionOptions.messages?: Anthropic.MessageParam[]` plus an
  `Anthropic.Messages.TextBlockParam` filter in
  `extractApprovalContext`.
- `src/core/tools/delegate.ts` — `messages: Anthropic.Messages.MessageParam[]`,
  `systemBlocks: Anthropic.Messages.TextBlockParam[]`.
- `src/core/tools/delegate-turn.ts` — `TurnLoopOptions.messages /
  systemBlocks`, `Anthropic.Messages.ToolUseBlock` filter, and
  `Anthropic.Messages.ToolResultBlockParam["content"]` casts (the
  `Anthropic.Message` response shape here is Stage 5 territory and must
  not be touched in this stage).
- `src/core/modules/provider-types.ts` —
  `HistoryProvider.save(messages: Anthropic.MessageParam[], ...)`, the
  persistence boundary contract every history module targets.

Two core test files also carry Anthropic-shaped fixtures that must move
in lockstep so the tree stays green:
`src/core/loop/compaction.test.ts` and
`src/core/loop/observation-masking.test.ts`.

Every non-Anthropic provider (OpenAI tools, openai-tools agent harness,
thin agent harness, future local backends) has to translate on both
sides of this surface today. Leaving it in core keeps the loop, the
delegate sub-agent, and the history persistence contract nailed to one
vendor's namespace and prevents Stage 5 (`KotaModelResponse` and
`KotaMessageStream`) from landing because the loop cannot consume
`KotaModelResponse` into a `Context` whose canonical `Message` is still
`Anthropic.MessageParam`.

## Desired Outcome

A single neutral message and block protocol owned by
`src/core/agent-harness/message-protocol.ts` replaces every
`Anthropic.MessageParam` / `Anthropic.Message` / block-shape reference
inside `src/core/` listed above. The new types are:

```ts
type KotaRole = "user" | "assistant";
type KotaCacheControl = { type: "ephemeral" };
type KotaTextBlock = { type: "text"; text: string; cache_control?: KotaCacheControl };
type KotaToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type KotaImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type KotaToolResultBlockContent = string | Array<KotaTextBlock | KotaImageBlock>;
type KotaToolResultBlock = { type: "tool_result"; tool_use_id: string; content: KotaToolResultBlockContent; is_error?: boolean };
type KotaContentBlock = KotaTextBlock | KotaToolUseBlock | KotaToolResultBlock | KotaImageBlock;
type KotaMessage = { role: KotaRole; content: string | KotaContentBlock[] };
```

These shapes are structurally compatible with Anthropic's so the
`claude-agent-harness` and `model-clients/anthropic` adapter seams can
pass values through with a narrow, explicit translation helper (no
shape change on the wire). After the migration, the ten core files
listed above no longer reference any `Anthropic.MessageParam` /
`Anthropic.Message` / `Anthropic.Messages.*BlockParam` /
`Anthropic.Messages.ToolUseBlock` type. The two loop test files migrate
their fixtures to `KotaMessage` in the same PR.

The `Anthropic.Message` response shape on
`Context.addAssistantMessage` and on `delegate-turn.ts` is scoped to
Stage 5 (`KotaModelResponse`) and is intentionally untouched here. That
boundary is the last remaining Anthropic import in each of those files
after this stage lands, and Stage 5 picks it up.

Adapter-side:
- `src/modules/model-clients/anthropic.ts` gains explicit
  `kotaMessageToAnthropicMessage()` / `kotaBlockToAnthropicBlock()`
  helpers at its translation seam. Translation is field-for-field with
  no `as` cast past the helper. Its own tests keep Anthropic-shaped
  literals because they test the seam itself.
- `src/modules/model-clients/openai/translations.ts` gains a
  `kotaMessageToOpenAiMessage()` (and inverse if needed by existing
  call sites) that converts `KotaMessage` to the OpenAI chat
  completion shapes. The existing openai translation tests
  (`translations.test.ts`) extend to cover the new codepath with a
  round-trip check across every `KotaContentBlock` variant.
- `src/modules/claude-agent-harness/adapter.ts` accepts `KotaMessage[]`
  and `KotaTextBlock[]` at its boundary and converts to
  `MessageParam[]` / `TextBlockParam[]` at the SDK call.
- `src/modules/openai-tools-agent-harness` and
  `src/modules/thin-agent-harness` accept `KotaMessage[]` at their
  loop entry.
- History-provider implementations under `src/modules/history/*`
  accept `KotaMessage[]` at the persistence boundary. Wire format on
  disk does not change: `KotaMessage` is JSON-compatible with the
  Anthropic-shaped records already stored. No migration of existing
  history files is required.

## Constraints

- Implements Stage 4 of `src/core/agent-harness/anthropic-type-audit.md`
  exactly as scoped there — no scope creep into Stage 5
  (`KotaModelResponse` / `KotaMessageStream`) or Stage 6 (import guard
  + AGENTS.md upgrade).
- `Context.addAssistantMessage(message: Anthropic.Message)` keeps its
  `Anthropic.Message` parameter until Stage 5; the call site that
  produces that value
  (`src/core/loop/loop-send.ts` → `finalMessage()`) also stays on the
  Anthropic response type for this stage. This stage only neutralizes
  the `Message = Anthropic.MessageParam` transcript alias on
  `Context`, `addToolResults` content, and the block filters that
  inspect the assistant message's `.content`.
- `delegate-turn.ts` keeps `response: Anthropic.Message` on its
  `TurnLoopOptions` until Stage 5; this stage only neutralizes its
  `messages: Anthropic.Messages.MessageParam[]`,
  `systemBlocks: Anthropic.Messages.TextBlockParam[]`, tool-use filter,
  and tool-result content cast.
- Discriminated union on every block type — no optional-field
  "either text or tool_use" shape. `KotaContentBlock` is a strict
  union and every caller narrows on `block.type`.
- `content: string | KotaContentBlock[]` on `KotaMessage` matches the
  existing Anthropic shape because the history store and the loop both
  rely on the "bare string shortcut" for simple user/assistant turns.
  Do not force normalize to `KotaContentBlock[]` in this stage — that
  is a separate simplification and would expand scope.
- No parallel type appears beside an Anthropic shape inside `src/core/`.
  Every listed call site migrates in lockstep within this PR so the
  tree stays green end-to-end, not just per-file.
- No backwards-compatibility shim, "accept either shape" branch, or
  structural cast at the core boundary. The Anthropic shape
  disappears from the listed core files in this PR.
- No new top-level re-export of any `Anthropic.*` type from
  `src/core/agent-harness/` or the agent-harness index.
  `message-protocol.ts` is the single source of truth for the new
  types, alongside `KotaTool`, `KotaToolInputSchema`, and
  `KotaThinkingConfig`.
- History providers' on-disk format does not change. The persistence
  boundary takes the neutral type; the JSON written to disk is byte-
  compatible with today's stored messages. No migration code, no
  schema version bump, no read-path coercion layer.
- Tests that already exist under `src/core/loop/*.test.ts`,
  `src/context.test.ts`, `src/reflection.test.ts`, and
  `src/message-pruning.test.ts` must still pass unchanged in behavior;
  literal fixtures move to `KotaMessage` / `KotaContentBlock` shape in
  the same PR. No behavioral assertion changes.
- Openai-tools translations gain a round-trip test covering every
  `KotaContentBlock` variant (text, tool_use, tool_result with string
  content, tool_result with block content, image). This is the Stage
  4 equivalent of the existing Anthropic-side pass-through.
- Rail stays tight: the agent-harness `types.ts` / `message-protocol.ts`
  file-size budget (~300 lines) is honored. If either file would
  exceed the budget, split `message-protocol-blocks.ts` out inside the
  same directory — do not scatter types across core.

## Done When

- `src/core/agent-harness/message-protocol.ts` exports
  `KotaMessage`, `KotaRole`, `KotaContentBlock`, `KotaTextBlock`,
  `KotaToolUseBlock`, `KotaToolResultBlock`,
  `KotaToolResultBlockContent`, `KotaImageBlock`, and
  `KotaCacheControl` with the shapes listed in Desired Outcome, and
  these types are re-exported from the agent-harness index alongside
  `KotaTool`, `KotaToolInputSchema`, and `KotaThinkingConfig`.
- None of the ten core files listed in Problem imports
  `Anthropic.MessageParam`, `Anthropic.Message` (except where Stage 5
  explicitly reserves it on the assistant-response path),
  `Anthropic.Messages.ContentBlockParam`,
  `Anthropic.Messages.TextBlockParam`,
  `Anthropic.Messages.ToolUseBlock`,
  `Anthropic.Messages.ToolUseBlockParam`, or
  `Anthropic.Messages.ToolResultBlockParam`. Every type-alias and
  signature listed migrates to the neutral equivalent. The
  `context.ts` / `delegate-turn.ts` files keep only the
  `Anthropic.Message` reference on the assistant-response path.
- `src/modules/model-clients/anthropic.ts` translates `KotaMessage`
  → `Anthropic.MessageParam` (and each block variant accordingly) at
  its adapter seam with explicit field mapping (no `as` cast past the
  seam). Its existing translation tests continue to pass; new round-
  trip coverage exists for each block variant if not already present.
- `src/modules/model-clients/openai/translations.ts` exposes a
  `kotaMessageToOpenAiMessage()` conversion used by the provider
  adapter, with a round-trip test in `translations.test.ts` covering
  every `KotaContentBlock` variant.
- `src/modules/claude-agent-harness/adapter.ts` accepts `KotaMessage[]`
  and `KotaTextBlock[]` at its boundary; the Anthropic-shaped `messages`
  / `system` values handed to the SDK are produced inside this module
  only.
- `src/modules/openai-tools-agent-harness` and
  `src/modules/thin-agent-harness` loop entry points accept
  `KotaMessage[]` rather than an Anthropic-typed array.
- Every `HistoryProvider` implementation under `src/modules/history/*`
  compiles and passes its existing tests against the
  `KotaMessage[]`-typed `save` signature. No on-disk format change; no
  migration shim.
- Existing loop, reflection, message-pruning, compaction, masking,
  tool-runner, delegate, and history tests still pass unchanged in
  behavior; literal fixtures are updated to `KotaMessage` /
  `KotaContentBlock` shape.
- `src/core/agent-harness/anthropic-type-audit.md` is updated to mark
  Stage 4 as landed (same pattern Stage 2 and Stage 3 use). The
  "Follow-up tasks" section retains Stage 5 (KotaModelResponse /
  KotaMessageStream) and Stage 6 (import guard + AGENTS.md upgrade) as
  the next two tasks explorer can seed.
- Repo typechecks and the full test suite pass green on the final
  commit of the PR.
