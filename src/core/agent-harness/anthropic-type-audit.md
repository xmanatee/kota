# Anthropic SDK Type-Surface Audit

This audit inventories every file in `src/core/` that imports types from
`@anthropic-ai/sdk` and treats the Anthropic SDK's type surface as the canonical
internal message/tool protocol. It replaces the implicit boundary claim
("core doesn't import the `@anthropic-ai/claude-agent-sdk` wrapper") with a
stronger working target: **no core file uses an Anthropic SDK type as the name
of an internal contract**. The staged plan turns each load-bearing Anthropic
shape into a KOTA-owned neutral type and lists the follow-up tasks explorer can
seed directly.

The audit is scoped to `src/core/`; module-side code (`src/modules/...`) that
legitimately speaks the Anthropic SDK at its adapter seam is listed only when a
core contract forces a conversion at that seam.

## Import inventory

The inventory below captures the Stage-0 state. Stages 1 and 2 have landed —
`Anthropic.Tool.InputSchema` and `Anthropic.Tool` are no longer referenced by
any file under `src/core/`. The rows tagged **tools (...)** therefore no
longer hold; they remain for historical reference.

38 files under `src/core/` currently import `type Anthropic from "@anthropic-ai/sdk"`:

| Area | File | Role |
|---|---|---|
| tools (schema) | `src/core/tools/tool-adapters-zod.ts` | `Anthropic.Tool.InputSchema` builder |
| tools (definition) | `src/core/tools/agent-status.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/approval.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/ask-owner.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/ask-user.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/checkpoint.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/confirm.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/module-factory/definition.ts` | `Anthropic.Tool` declaration |
| tools (definition) | `src/core/tools/todo.ts` | `Anthropic.Tool` declaration |
| tools (registry) | `src/core/tools/index.ts` | `Anthropic.Tool[]` on `ToolRegistration`, `getAllTools`, `registerTool`, `resolveToolSet`, `getRegisteredTools` |
| tools (registry) | `src/core/tools/tool-groups.ts` | `filterTools`, `buildEnableToolsTool`, `enableToolsTool` all keyed on `Anthropic.Tool` |
| tools (registry) | `src/core/tools/custom-tool.ts` | `Anthropic.Tool`, `Anthropic.Tool.InputSchema` at the dynamic-tool registration seam |
| tools (registry) | `src/core/tools/custom-tool-handlers.ts` | same seam as `custom-tool.ts` |
| tools (runtime) | `src/core/tools/tool-runner.ts` | `Anthropic.MessageParam[]` on `ToolCallExecutionOptions`, `Anthropic.Messages.TextBlockParam` filter when extracting approval context |
| tools (delegate) | `src/core/tools/delegate.ts` | `Anthropic.Tool`, `Anthropic.Messages.MessageParam`, `Anthropic.Messages.TextBlockParam` |
| tools (delegate) | `src/core/tools/delegate-turn.ts` | `TurnLoopOptions.messages/systemBlocks/tools`, `Anthropic.Message`, `Anthropic.Messages.ToolUseBlock`, `Anthropic.Messages.ToolResultBlockParam` |
| tools (tests) | `src/core/tools/tool-registry.integration.test.ts` | test-only `Anthropic.Tool` fixture |
| model client | `src/core/model/model-client.ts` | `ModelClient.messages.{stream,create}` and `MessageStream` defined in terms of `Anthropic.Message`, `Anthropic.MessageParam[]`, `Anthropic.Messages.TextBlockParam[] \| string`, `Anthropic.Tool[]`, `Anthropic.Messages.ThinkingConfigParam` |
| model client | `src/core/model/streaming.ts` | `StreamConfig` / `streamMessage` return types pinned to same shapes |
| model client | `src/core/model/mock-client.ts` | E2E fixtures built as `Anthropic.Message`, `Anthropic.ContentBlock`, `Anthropic.MessageParam`, `Anthropic.Tool`; also records calls with Anthropic shapes |
| model client (tests) | `src/core/model/model-client.test.ts` | test-only `Anthropic.Message` fixtures |
| loop | `src/core/loop/loop.ts` | `Anthropic.Messages.ThinkingConfigParam` private field |
| loop | `src/core/loop/loop-init.ts` | same |
| loop | `src/core/loop/loop-send.ts` | `Anthropic.Messages.TextBlockParam[]` for system, `Anthropic.Messages.ToolUseBlock` filter on assistant content |
| loop | `src/core/loop/context.ts` | `type Message = Anthropic.MessageParam`, `Context.addAssistantMessage(Anthropic.Message)`, `Anthropic.Messages.ToolResultBlockParam["content"]` on `addToolResults` |
| loop | `src/core/loop/compaction.ts` | canonical `Message`/`ContentBlock` aliases + casts to `Anthropic.Messages.ToolUseBlockParam` / `ToolResultBlockParam` / `TextBlockParam` |
| loop | `src/core/loop/observation-masking.ts` | same canonical aliases + helper signatures typed on `Anthropic.Messages.ToolResultBlockParam` |
| loop | `src/core/loop/reflection.ts` | same canonical aliases, block casts for text extraction |
| loop | `src/core/loop/message-pruning.ts` | same canonical aliases, casts for tool-use/tool-result blocks |
| loop | `src/core/loop/pre-send-hooks.ts` | `PreSendContext.messages: Anthropic.Messages.MessageParam[]`, `thinkingConfig: Anthropic.Messages.ThinkingConfigParam` |
| loop (tests) | `src/core/loop/compaction.test.ts` | test-only `MessageParam` fixtures |
| loop (tests) | `src/core/loop/observation-masking.test.ts` | test-only `MessageParam` fixtures |
| agents | `src/core/agents/delegate-prompts.ts` | `Anthropic.Tool` on `subShellTool` + tool-set return signatures |
| mcp | `src/core/mcp/manager.ts` | `toAnthropicTool`, `McpManager.getTools(): Anthropic.Tool[]`, `anthropicTools: Anthropic.Tool[]` |
| manifest | `src/core/manifest/execution.ts` | `Anthropic.Tool["input_schema"]` cast when building `ToolDef` from a manifest |
| modules | `src/core/modules/module-types.ts` | `ToolDef.tool: Anthropic.Tool` — the contract every module contribution targets |
| modules | `src/core/modules/foreign-module.ts` | KEMP `manifest.tools[].input_schema: Anthropic.Tool["input_schema"]` — an out-of-process wire field |
| modules | `src/core/modules/provider-types.ts` | `HistoryProvider.save(messages: Anthropic.MessageParam[], ...)` — persistence boundary |

### Role classification

Every import falls into one of five roles:

1. **Tool-definition / schema shapes** (`Anthropic.Tool`, `Anthropic.Tool.InputSchema`).
   This is KOTA's canonical tool contract: every core tool file declares itself
   this way, every module contributes `ToolDef.tool` this way, every consumer
   (`McpManager.getTools()`, `delegate-prompts.getExploreToolSet()`,
   `getAllTools()`, `resolveToolSet()`) hands these around, and the KEMP foreign
   manifest and tool-adapters-zod builder target the same shape. This is the
   widest surface: 21 files reference it.

2. **Internal message / content shapes** (`Anthropic.MessageParam`,
   `Anthropic.Message`, `Anthropic.Messages.ContentBlockParam`,
   `Anthropic.Messages.TextBlockParam`, `Anthropic.Messages.ToolUseBlock`,
   `Anthropic.Messages.ToolUseBlockParam`,
   `Anthropic.Messages.ToolResultBlockParam`).
   Used by the conversation loop (`context.ts`, `loop-send.ts`), compaction,
   masking, pruning, reflection, tool-runner approval-context extraction, and
   the delegate sub-agent. `context.addAssistantMessage()` takes an
   `Anthropic.Message` verbatim; `addToolResults()` casts to
   `ToolResultBlockParam["content"]`. These shapes are the implicit wire
   between `ModelClient` and every loop primitive.

3. **Reasoning / thinking shapes** (`Anthropic.Messages.ThinkingConfigParam`).
   Reaches from `AgentSession.thinkingConfig` through `loop-init.ts`,
   `loop-send.ts`, `pre-send-hooks.ts`, `StreamConfig`, and
   `MessageStreamParams`. Providers without a native "thinking" channel
   (OpenAI o-series, local models) have to encode/decode on both sides of this
   Anthropic shape.

4. **Model-client request / response shapes** (`MessageStreamParams`,
   `MessageCreateParams`, `MessageStream`). Defined in `model-client.ts` but
   expressed in terms of the message/tool/thinking shapes above. Any non-
   Anthropic provider (`src/modules/model-clients/openai/*`) must translate on
   every call to match core's types.

5. **Test-only fixtures** (`tool-registry.integration.test.ts`,
   `model-client.test.ts`, `compaction.test.ts`,
   `observation-masking.test.ts`). Each constructs `Anthropic.MessageParam`
   literals or uses `mock-client`'s Anthropic-shaped builders. These follow
   along as each production shape becomes neutral.

There are no genuinely neutral types that happen to be re-exported through the
`Anthropic` namespace; every import is load-bearing.

## Ownership target

Core should own a single neutral internal protocol and translate at module-owned
adapter seams. Concretely:

- **Core owns** (new neutral types): `KotaTool`, `KotaToolInputSchema`,
  `KotaMessage`, `KotaTextBlock`, `KotaToolUseBlock`, `KotaToolResultBlock`,
  `KotaContentBlock`, `KotaThinkingConfig`, `KotaModelResponse`,
  `KotaModelUsage`, `KotaMessageStream`, `KotaMessageStreamParams`,
  `KotaMessageCreateParams`. All live in `src/core/agent-harness/types.ts`
  (alongside the existing `Agent*` neutral shapes), or an adjacent
  `message-protocol.ts` if `types.ts` outgrows its ~300-line budget.
- **`claude-agent-harness` module owns** the translation from `KotaMessage` /
  `KotaTool` / `KotaThinkingConfig` to the Anthropic SDK wire shapes at the
  adapter seam. The module's existing boundary already handles `mcpServers`,
  `permissionMode`, and `settingSources`; message/tool translation fits there.
- **`model-clients/anthropic` module owns** translation from `KotaMessage` /
  `KotaTool` to `Anthropic.MessageParam` / `Anthropic.Tool` at the provider
  wire. The Anthropic provider already has this seam; today it's a no-op
  because both sides speak the Anthropic shape, so the change is additive
  (explicit conversion instead of pass-through).
- **`model-clients/openai` module owns** translation from `KotaMessage` /
  `KotaTool` to `ChatCompletion*` shapes. It already has `translations.ts`
  doing this work in the reverse direction; the change replaces the Anthropic
  input type with `KotaMessage`.
- **`thin-agent-harness` / `openai-tools-agent-harness` modules** translate
  `KotaTool` to their native loop inputs; they already use `translations.ts`
  and can keep doing so.
- **`mcp-server` module** keeps accepting MCP tool schemas and converts to
  `KotaTool` instead of `Anthropic.Tool`.
- **Foreign modules (KEMP)** keep the JSON-Schema shape on the wire, but the
  field type in `foreign-module.ts` becomes `KotaToolInputSchema` — the neutral
  type still resolves to a JSON Schema object, so no wire change is needed.

`AgentMessage` / `AgentContentBlock` (already in
`src/core/agent-harness/types.ts`) describe *runtime streaming frames* that
harness adapters emit to `onMessage`. They overlap with `KotaMessage` but are a
distinct surface — streaming frames include status/result variants that don't
belong in the conversation transcript. The plan does not merge them; it adds
the transcript-level types alongside.

## Test coverage target

The neutral types prove parity through three layers of test coverage:

- **Core unit tests** for every new `Kota*` type (`src/core/agent-harness/`
  gets co-located `message-protocol.test.ts` that exercises the shape of every
  block variant and every message role).
- **Translation round-trip tests** inside each adapter module: given a
  `KotaMessage` with each block variant (text, tool_use, tool_result with
  string content, tool_result with block content, tool_result with image),
  round-trip it through the module's translator and assert equality of the
  observable fields. The openai-tools module already has
  `translations.test.ts`; this pattern extends to the anthropic and
  claude-agent-harness modules.
- **Loop-level golden tests** that run `AgentSession.send()` end-to-end against
  a mock model client producing neutral `KotaModelResponse` fixtures. Existing
  tests in `src/context.test.ts`, `src/reflection.test.ts`,
  `src/message-pruning.test.ts`, `src/core/loop/compaction.test.ts`,
  `src/core/loop/observation-masking.test.ts`, and
  `src/core/model/model-client.test.ts` already cover these flows; the
  migration replaces their Anthropic-shaped fixtures with neutral ones.

## Staged plan

Each stage lands on its own without turning the tree red. Each stage ends with
the Anthropic imports it removed being absent from the touched files, and no
new parallel type appearing beside an Anthropic shape. Stages are ordered so
that earlier stages unblock later stages (tool-definition types are cheapest
and most independent; message-protocol types require more callers to move in
lockstep). A stage should be landed as one cohesive PR.

### Stage 1 — `KotaToolInputSchema`

Introduce `KotaToolInputSchema` in `src/core/agent-harness/types.ts` as the
neutral JSON Schema object shape (`{ type: "object"; properties: Record<...>;
required?: string[]; ... }`). Structurally compatible with
`Anthropic.Tool.InputSchema`, so the claude and anthropic modules pass it
through. Migrate:

- `src/core/tools/tool-adapters-zod.ts` — `buildInputSchema(): KotaToolInputSchema`.
- `src/core/tools/custom-tool.ts`, `src/core/tools/custom-tool-handlers.ts` — replace `as Anthropic.Tool.InputSchema` casts with `KotaToolInputSchema`.
- `src/core/manifest/execution.ts` — `t.parameters as KotaToolInputSchema`.
- `src/core/modules/foreign-module.ts` — `KempManifest.tools[].input_schema: KotaToolInputSchema`.

Rails: these files keep their `type Anthropic` import only if they also
reference `Anthropic.Tool` (most do); the `InputSchema` import is what goes
away. Stage 2 finishes the cleanup by removing the `Anthropic.Tool` reference.

### Stage 2 — `KotaTool` (landed)

`KotaTool = { name: string; description: string; input_schema:
KotaToolInputSchema }` lives in `src/core/agent-harness/message-protocol.ts`
and is exported from the agent-harness index. No file under `src/core/`
references `Anthropic.Tool` any more — every core tool declaration, registry
function, MCP bridge entry, manifest execution path, delegate sub-agent, and
module-contribution contract (`ToolDef.tool`) speaks `KotaTool`. The
`StreamConfig.tools`, `MessageStreamParams.tools`, and `MockApiCall.tools`
fields on the model-client boundary are also `KotaTool[]`; the remaining
message/thinking shapes there are Stage 3–5 territory.

Module tool declarations across the repo (filesystem, execution, browser,
web-access, git, memory, composition, system, scheduler, secrets,
working-memory, prompt-templates, knowledge, guardrails-audit, read-document,
history/conversation-recall) were migrated to `KotaTool` in the same stage so
the `ToolDef.tool: KotaTool` contract has no optional-description gap with
`Anthropic.Tool.description?`. The five adapter seams flipped their declared
input type:

- `claude-agent-harness/adapter.ts` accepts `KotaTool[]` and passes through.
- `model-clients/anthropic.ts` introduces an explicit `kotaToAnthropicTool()`
  helper — a structural no-op today, but the call-site is the new invariant.
- `model-clients/openai/translations.ts` typed `toOpenAITools(tools:
  KotaTool[])`.
- `openai-tools-agent-harness` typed its `selectToolDefinitions()` return on
  `KotaTool[]`.
- `thin-agent-harness` has no tool loop, so no input to flip.
- `mcp-server` renamed `anthropicToMcp` → `kotaToolToMcp` and types
  `moduleToolList`, `getExposedTools()` on `KotaTool`.

After this stage, role (1) is gone from core.

### Stage 3 — `KotaThinkingConfig`

Introduce `KotaThinkingConfig = { type: "enabled"; budget_tokens: number } |
{ type: "disabled" }` (structurally matching `ThinkingConfigParam`). Migrate:

- `src/core/loop/loop.ts`, `loop-init.ts`, `loop-send.ts` — private field and flow types.
- `src/core/loop/pre-send-hooks.ts` — `PreSendContext.thinkingConfig: KotaThinkingConfig | undefined`.
- `src/core/model/streaming.ts` — `StreamConfig.thinkingConfig: KotaThinkingConfig | undefined`.
- `src/core/model/model-client.ts` — `MessageStreamParams.thinking?: KotaThinkingConfig`.

Adapter-side: the anthropic model client converts `KotaThinkingConfig` →
`Anthropic.Messages.ThinkingConfigParam` (field-for-field). The openai client's
reasoning translation keys off `KotaThinkingConfig` instead of the Anthropic
shape it currently reads in `src/modules/model-clients/openai/client.ts`.

This stage is small; its main value is unblocking Stage 4 by freeing loop
files from one of the two Anthropic shapes they reference.

### Stage 4 — `KotaMessage` + block types

Introduce neutral message and block types in
`src/core/agent-harness/message-protocol.ts`:

```ts
type KotaRole = "user" | "assistant";
type KotaTextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type KotaToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type KotaToolResultBlockContent = string | Array<KotaTextBlock | KotaImageBlock>;
type KotaToolResultBlock = { type: "tool_result"; tool_use_id: string; content: KotaToolResultBlockContent; is_error?: boolean };
type KotaImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type KotaContentBlock = KotaTextBlock | KotaToolUseBlock | KotaToolResultBlock | KotaImageBlock | KotaThinkingBlock;
type KotaMessage = { role: KotaRole; content: string | KotaContentBlock[] };
```

Migrate:

- `src/core/loop/context.ts` — `type Message = KotaMessage`; `Context.addAssistantMessage(message: KotaModelResponse)` (see Stage 5); `addToolResults` content typed as `KotaToolResultBlock["content"]`.
- `src/core/loop/compaction.ts`, `observation-masking.ts`, `reflection.ts`, `message-pruning.ts` — replace `Anthropic.MessageParam`, `Anthropic.Messages.ContentBlockParam`, and block-param casts with `KotaMessage` / `KotaContentBlock` / `KotaToolUseBlock` / `KotaToolResultBlock` / `KotaTextBlock`.
- `src/core/loop/loop-send.ts` — `system: KotaTextBlock[]`; `ToolUseBlock` filter keys off `KotaToolUseBlock`.
- `src/core/loop/pre-send-hooks.ts` — `PreSendContext.messages: KotaMessage[]`.
- `src/core/tools/tool-runner.ts` — `extractApprovalContext(messages: KotaMessage[], ...)`; `ToolCallExecutionOptions.messages?: KotaMessage[]`.
- `src/core/tools/delegate.ts`, `delegate-turn.ts` — `messages: KotaMessage[]`, `systemBlocks: KotaTextBlock[]`, `Anthropic.Messages.ToolUseBlock` filter → `KotaToolUseBlock`, `Anthropic.Messages.ToolResultBlockParam["content"]` cast → `KotaToolResultBlock["content"]`.
- `src/core/modules/provider-types.ts` — `HistoryProvider.save(messages: KotaMessage[], ...)`.
- Loop tests under `src/core/loop/*.test.ts` and the top-level fixtures in `src/context.test.ts`, `src/reflection.test.ts`, `src/message-pruning.test.ts` — rebuild on `KotaMessage`.

Adapter-side translation: the anthropic and claude-agent-sdk modules convert
`KotaMessage` → `Anthropic.MessageParam` inside their own translators. The
openai module's `translations.ts` gets a new codepath
`kotaMessageToOpenAiMessage()` (or its inverse) for the conversation transcript.

### Stage 5 — `KotaModelResponse` + `KotaMessageStream`

Introduce:

```ts
type KotaModelUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
type KotaModelResponse = { id: string; role: "assistant"; model: string; content: KotaContentBlock[]; stop_reason: string; usage: KotaModelUsage };
interface KotaMessageStream { on(event: "text" | "thinking", cb: (delta: string) => void): this; finalMessage(): Promise<KotaModelResponse>; }
type KotaMessageStreamParams = { model: string; max_tokens: number; system?: KotaTextBlock[] | string; messages: KotaMessage[]; tools?: KotaTool[]; thinking?: KotaThinkingConfig; effort?: AgentEffort };
type KotaMessageCreateParams = { model: string; max_tokens: number; system?: string; messages: KotaMessage[] };
```

Migrate:

- `src/core/model/model-client.ts` — replace `Anthropic.Message`, `Anthropic.MessageParam[]`, `Anthropic.Messages.TextBlockParam[]`, `Anthropic.Tool[]`, `Anthropic.Messages.ThinkingConfigParam` in `MessageStream`, `MessageStreamParams`, `MessageCreateParams`, `ModelClient`.
- `src/core/model/streaming.ts` — `StreamConfig` + `streamMessage()` return types.
- `src/core/model/mock-client.ts` — fixtures return `KotaModelResponse`, `MockApiCall` records `KotaMessage[]` / `KotaTool[]`.
- `src/core/model/model-client.test.ts`, `src/openai-model-client.test.ts` — rebuild fixtures on neutral types.
- `src/core/loop/context.ts` — `addAssistantMessage(message: KotaModelResponse)` (last Anthropic import falls out of the loop).
- `src/core/loop/loop-send.ts`, `src/core/loop/compaction.ts` — consume `KotaModelResponse`.
- `src/core/tools/delegate-turn.ts` — `response: KotaModelResponse`.

Adapter-side: every `ModelClient` implementation
(`src/modules/model-clients/anthropic/*`, `openai/*`, `failover-client.ts`)
translates its native stream and final-message types into the neutral shapes
at the adapter boundary. The Anthropic provider's adapter becomes the only
place that imports `@anthropic-ai/sdk`.

At the end of Stage 5 no file under `src/core/` imports from
`@anthropic-ai/sdk`, and every Anthropic type used by a core primitive has a
neutral KOTA equivalent.

### Stage 6 — enforce and document

Once stages 1-5 land:

- Add a `no-anthropic-imports-in-core.test.ts` under
  `src/core/agent-harness/` that walks `src/core/**/*.ts` and asserts no
  `@anthropic-ai/sdk` import remains. This replaces the soft boundary claim
  with a loud failure mode, the same pattern other core boundaries use.
- Update `src/core/agent-harness/AGENTS.md` to state the stronger claim:
  *nothing in core treats Anthropic's SDK type surface as its internal
  protocol*, and cross-reference this audit.
- Add short sections in
  `src/modules/{claude-agent-harness,model-clients/anthropic,model-clients/openai,openai-tools-agent-harness,thin-agent-harness,mcp-server}/AGENTS.md`
  noting the translation responsibility at each adapter seam (one sentence per
  module).

## Fixture-churn containment

Migration of the Anthropic-shaped test fixtures concentrates in:

- `src/core/model/mock-client.ts` (the source of truth for fixture builders)
- `src/core/loop/compaction.test.ts`, `src/core/loop/observation-masking.test.ts`
- `src/context.test.ts`, `src/reflection.test.ts`,
  `src/message-pruning.test.ts`, `src/openai-model-client.test.ts`

The plan contains churn by converting `mock-client.ts` first within Stage 5:
once the exported `textResponse`, `toolUseResponse`, `multiToolResponse`, and
`createMockClient` helpers return `KotaModelResponse`/`KotaMessage`, every
dependent test moves by changing imports rather than rewriting fixtures.
Module-side fixtures that still target the Anthropic wire
(`src/modules/model-clients/anthropic.test.ts`) continue to use
`Anthropic.Message` literals because they test the translation seam itself.

## Follow-up tasks

Stages 1 and 2 have landed. Explorer can seed each remaining stage as its
own task, in the order listed:

1. **Introduce neutral `KotaThinkingConfig` and migrate loop +
   model-client surfaces** — implements Stage 3. Scope: six files listed under
   Stage 3 plus the anthropic and openai model-client translations.
2. **Introduce neutral `KotaMessage` protocol and migrate the loop,
   compaction, masking, pruning, reflection, delegate, and history-provider
   surfaces** — implements Stage 4. Scope: ten core files plus loop-level
   tests and the anthropic/openai/claude-agent-harness translation seams.
3. **Introduce neutral `KotaModelResponse` and `KotaMessageStream` and complete
   the model-client migration** — implements Stage 5. Scope: `model-client.ts`,
   `streaming.ts`, `mock-client.ts`, the five loop consumers of the assistant
   response, `delegate-turn.ts`, and every `ModelClient` implementation in
   `src/modules/model-clients/*`.
4. **Enforce the neutral-protocol boundary in core with an import guard** —
   implements Stage 6. Scope: the `no-anthropic-imports-in-core` test, the
   `src/core/agent-harness/AGENTS.md` upgrade, and the one-line adapter-seam
   statements in module-side `AGENTS.md`.
