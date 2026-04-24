---
id: task-introduce-neutral-kotamodelresponse-and-complete-t
title: Introduce neutral KotaModelResponse and complete the model-client migration
status: ready
priority: p2
area: architecture
summary: Implement Stage 5 of the Anthropic SDK type-surface audit: add neutral KotaModelResponse / KotaMessageStream / KotaModelUsage and migrate ModelClient, MessageStream, streaming, mock-client, context.addAssistantMessage, loop-send finalMessage, delegate-turn response, and every model-client module so nothing in core imports @anthropic-ai/sdk except adapter seams.
created_at: 2026-04-24T06:23:48.664Z
updated_at: 2026-04-24T06:23:48.664Z
---

## Problem

`src/core/agent-harness/anthropic-type-audit.md` lays out a six-stage plan
to remove every `@anthropic-ai/sdk` type import from `src/core/`. Stages 1
(`KotaToolInputSchema`), 2 (`KotaTool`), 3 (`KotaThinkingConfig`), and 4
(`KotaMessage` + block types) have landed. Roles (1) "tool-definition /
schema shapes", (2) "internal message / content shapes", and (3)
"reasoning / thinking shapes" are gone from core.

The last load-bearing Anthropic surface still referenced by `src/core/` is
role (4), the assistant-response path — the only codepath by which an
Anthropic SDK type still names an internal core contract:

- `src/core/model/model-client.ts` — `MessageStream.finalMessage(): Promise<Anthropic.Message>` and `ModelClient.messages.create(params): Promise<Anthropic.Message>`.
- `src/core/model/streaming.ts` — `streamMessage()` return type `{ response: Anthropic.Message, … }` on `StreamConfig`.
- `src/core/model/mock-client.ts` — every fixture builder returns `Anthropic.Message`; the constructor for `MockMessageStream` takes an `Anthropic.Message`; `MockApiCall.messages` records `Anthropic.MessageParam[]`.
- `src/core/model/model-client.test.ts` — all test fixtures are built as `Anthropic.Message` literals.
- `src/core/loop/context.ts` — `Context.addAssistantMessage(message: Anthropic.Message)`.
- `src/core/tools/delegate-turn.ts` — `response!: Anthropic.Message` on `TurnLoopOptions` and the local assignment in the turn loop.

Every non-Anthropic provider (the OpenAI client and its stream, the
failover client, and any future local backend) has to produce an
`Anthropic.Message` today, either by structural shape-matching or by
casting through the SDK type. That is the only reason the `openai/stream.ts`
and `failover-client.ts` files under `src/modules/model-clients/` still
import `@anthropic-ai/sdk`. Leaving it in core means the import guard
promised by Stage 6 cannot land and the "nothing in core treats
Anthropic's SDK type surface as its internal protocol" contract cannot be
enforced in code.

## Desired Outcome

A single neutral model-response protocol owned by
`src/core/agent-harness/message-protocol.ts` replaces every
`Anthropic.Message` reference inside `src/core/`. The new types are:

```ts
type KotaModelUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};
type KotaStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal";
type KotaModelResponse = {
  id: string;
  role: "assistant";
  model: string;
  content: KotaContentBlock[];
  stop_reason: KotaStopReason | null;
  stop_sequence?: string | null;
  usage: KotaModelUsage;
};
interface KotaMessageStream {
  on(event: "text", cb: (delta: string) => void): this;
  on(event: "thinking", cb: (delta: string) => void): this;
  finalMessage(): Promise<KotaModelResponse>;
}
```

`KotaModelResponse` is structurally compatible with `Anthropic.Message`
for the fields KOTA actually reads (`id`, `role`, `model`, `content`,
`stop_reason`, `stop_sequence`, `usage.*`). The Anthropic provider's
adapter at `src/modules/model-clients/anthropic.ts` becomes the single
point where the SDK's wider shape is narrowed to `KotaModelResponse`
field-for-field — no `as` cast past the seam. Every other ModelClient
implementation (OpenAI chat, OpenAI responses, failover, any future
local backend) builds `KotaModelResponse` directly without going
through `@anthropic-ai/sdk`.

After this stage:

- `ModelClient.messages.stream()` returns `KotaMessageStream`;
  `ModelClient.messages.create()` returns `Promise<KotaModelResponse>`.
- `StreamConfig` and `streamMessage()` return the neutral
  `{ response: KotaModelResponse, … }` shape.
- `Context.addAssistantMessage(message: KotaModelResponse): void` reads
  `response.content` directly (it already expects `KotaContentBlock[]`
  internally after Stage 4); no block translation is needed inside
  core.
- `TurnLoopOptions.response: KotaModelResponse` on
  `src/core/tools/delegate-turn.ts`; the local `response!` in the turn
  loop is typed accordingly.
- `src/core/model/mock-client.ts` exports `textResponse`,
  `toolUseResponse`, `multiToolResponse`, and `createMockClient`
  returning the neutral types; `MockApiCall.messages` is
  `KotaMessage[]`.
- `src/core/model/model-client.test.ts` fixtures are `KotaModelResponse`
  literals.
- No file under `src/core/` imports from `@anthropic-ai/sdk`.

Adapter-side:

- `src/modules/model-clients/anthropic.ts` exports an explicit
  `anthropicMessageToKotaResponse()` helper and a
  `wrapAnthropicStream()` that adapts the SDK's `MessageStream` to
  `KotaMessageStream`. Field-for-field mapping, no `as` cast past the
  helpers. Existing seam tests keep Anthropic-shaped literals because
  they test the translation itself.
- `src/modules/model-clients/openai/stream.ts` produces
  `KotaModelResponse` directly; the `messagePromise` becomes
  `Promise<KotaModelResponse>` and the public `finalMessage()` matches
  `KotaMessageStream`. The OpenAI client test fixtures migrate to the
  neutral type in the same PR.
- `src/modules/model-clients/failover-client.ts` drops its
  `@anthropic-ai/sdk` import; `doCreate` returns
  `Promise<KotaModelResponse>` and the wrapped `stream.finalMessage`
  keeps the `KotaMessageStream` shape.
- Every test under `src/modules/model-clients/` that builds a
  `finalMessage()` result inline migrates to `KotaModelResponse`
  (`failover-client.test.ts`, `openai/stream.test.ts`,
  `openai/client.test.ts`). The `anthropic.test.ts` seam test keeps its
  `Anthropic.Message` literals because it tests the translation.

## Constraints

- Implements Stage 5 of `src/core/agent-harness/anthropic-type-audit.md`
  exactly as scoped there — no scope creep into Stage 6 (import guard
  + AGENTS.md upgrade). Stage 6 stays a follow-up task because its
  concerns (adding the `no-anthropic-imports-in-core` test, upgrading
  the agent-harness `AGENTS.md`, and adding adapter-seam one-liners to
  the module `AGENTS.md` files) are orthogonal to the type migration.
- `KotaModelResponse`, `KotaModelUsage`, `KotaStopReason`, and
  `KotaMessageStream` live in
  `src/core/agent-harness/message-protocol.ts` alongside `KotaMessage`
  and friends. If the file would exceed its ~300-line budget, split a
  `message-protocol-response.ts` sibling in the same directory — do
  not scatter types across core.
- Discriminated on `stop_reason`: use the literal union listed in
  Desired Outcome. No `string` escape hatch, no optional-field "either
  shape or missing" form. If a provider produces a stop reason outside
  the union, translate it at the seam; do not widen the core type.
- `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`
  stay nullable (`number | null`) because the Anthropic SDK exposes
  them that way and the fields are read by the usage-accounting path
  verbatim. No new `undefined` axis.
- `KotaMessageStream` exposes only the events and final-message method
  that core already reads. Do not expose provider-specific events or a
  raw stream handle — this is the KOTA-owned surface, not a pass-
  through.
- No parallel type appears beside an Anthropic shape inside `src/core/`.
  Every listed call site migrates in lockstep within this PR so the
  tree stays green end-to-end, not just per-file.
- No backwards-compatibility shim, "accept either shape" branch, or
  structural cast at the core boundary. The Anthropic shape
  disappears from `src/core/` entirely in this PR (including
  `mock-client.ts` and `model-client.test.ts`).
- `mock-client.ts` stays the single source of truth for neutral
  response fixtures. Any dependent test
  (`src/core/loop/compaction.test.ts`,
  `src/core/loop/observation-masking.test.ts`, `src/context.test.ts`,
  `src/reflection.test.ts`, `src/message-pruning.test.ts`,
  `src/openai-model-client.test.ts`) moves by updating imports, not by
  rewriting fixtures.
- On-disk history format does not change. Assistant-message records
  were already `KotaMessage`-shaped after Stage 4; the new response
  type is only consumed in-memory and never serialized.
- `src/modules/model-clients/anthropic.ts` is the only place in the
  repo that may import `@anthropic-ai/sdk` when converting a response
  back to the neutral shape. Every other `ModelClient` implementation
  is explicitly forbidden from reaching for the SDK types just to
  satisfy the core contract. This is what makes Stage 6's import guard
  meaningful.
- Existing loop, reflection, message-pruning, compaction, masking,
  tool-runner, delegate, model-client, and provider tests must still
  pass unchanged in behavior; literal fixtures are updated to the
  neutral response shape. No behavioral assertion changes.

## Done When

- `src/core/agent-harness/message-protocol.ts` (or a sibling file in
  `src/core/agent-harness/`) exports `KotaModelResponse`,
  `KotaModelUsage`, `KotaStopReason`, and `KotaMessageStream` with the
  shapes listed in Desired Outcome, and these types are re-exported
  from the agent-harness index alongside `KotaMessage`, `KotaTool`,
  `KotaToolInputSchema`, and `KotaThinkingConfig`.
- No file under `src/core/` imports from `@anthropic-ai/sdk`. Every
  `Anthropic.Message` reference listed in Problem migrates to
  `KotaModelResponse`, and `MessageStream` is renamed / retyped to
  `KotaMessageStream` (or the public alias stays `MessageStream` but
  its definition is `KotaMessageStream` — pick one and stay consistent).
- `src/core/model/model-client.ts` exposes:
  `ModelClient.messages.stream(params): KotaMessageStream` and
  `ModelClient.messages.create(params): Promise<KotaModelResponse>`.
- `src/core/model/streaming.ts` returns `{ response: KotaModelResponse,
  … }` from `streamMessage()` and `StreamConfig.response` is neutral.
- `src/core/loop/context.ts` exposes
  `addAssistantMessage(message: KotaModelResponse)` and its body reads
  `message.content` as `KotaContentBlock[]` directly.
- `src/core/tools/delegate-turn.ts` declares
  `response!: KotaModelResponse` and `TurnLoopOptions.response:
  KotaModelResponse`.
- `src/core/model/mock-client.ts` exports fixture builders that return
  `KotaModelResponse`; `MockApiCall.messages: KotaMessage[]`.
- `src/modules/model-clients/anthropic.ts` exposes
  `anthropicMessageToKotaResponse()` (or an equivalent explicit helper)
  that produces `KotaModelResponse` field-for-field, and wraps the
  SDK's native `MessageStream` into a `KotaMessageStream`.
- `src/modules/model-clients/openai/stream.ts`,
  `src/modules/model-clients/openai/client.ts`, and
  `src/modules/model-clients/failover-client.ts` no longer import
  `@anthropic-ai/sdk` and produce `KotaModelResponse` directly.
- Every test fixture in `src/modules/model-clients/` except
  `anthropic.test.ts` (the translation seam itself) builds its
  response as `KotaModelResponse`.
- `src/core/agent-harness/anthropic-type-audit.md` is updated to mark
  Stage 5 as landed (same pattern Stages 2–4 use). The "Follow-up
  tasks" section retains Stage 6 (`no-anthropic-imports-in-core` test
  + `AGENTS.md` upgrade + one-line adapter-seam notes) as the next
  task explorer can seed.
- Repo typechecks and the full test suite pass green on the final
  commit of the PR.
