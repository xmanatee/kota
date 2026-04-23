---
id: task-stop-building-a-claudecode-preset-systemprompt-at-
title: Stop building a claude_code-preset systemPrompt at the harness-neutral seams
status: done
priority: p2
area: architecture
summary: Portable system-prompt content should flow through harness-neutral code as a string so the step executor, repair loop, and CLI entry do not mint claude-SDK-shaped preset objects that every other adapter has to unwrap.
created_at: 2026-04-23T02:19:35.583Z
updated_at: 2026-04-23T02:41:14.361Z
---

## Problem

`buildClaudeCodeSystemPrompt` (`src/core/agent-sdk/system-prompt.ts`) returns a
claude-agent-sdk-specific `SDKSystemPrompt` value:

```
{ type: "preset", preset: "claude_code", append: "<portable text>" }
```

That shape is claude-SDK wire structure. The portable text KOTA actually wants
to deliver — project context, instruction files, user profile, skills prompt,
autonomous-agent-instructions — is the `append` field; the envelope is
claude-specific.

It is called from three harness-neutral callsites that then pass the returned
object straight through `runAgentHarness`:

- `src/core/workflow/steps/step-executor-agent.ts` — every autonomy agent step
  builds the preset object and hands it to the resolved adapter.
- `src/core/workflow/repair-loop.ts` — every repair-loop judge does the same.
- `src/cli.ts` — the interactive CLI entry mints the same preset object for
  the selected harness.

The claude-agent-harness adapter passes the object directly to the SDK. Every
other adapter has to unwrap it:

- `src/modules/openai-tools-agent-harness/adapter.ts` (`extractSystemText`)
  detects the preset, reads `append`, and throws loudly if `append` is missing.
- `src/modules/thin-agent-harness/adapter.ts` performs an equivalent unwrap.

The effect is an inverted abstraction: harness-neutral code constructs a
claude-SDK-shaped value so non-claude adapters can dismantle it before their
own wire call. The documented "harness-neutral wire types" contract in
`src/core/agent-harness/types.ts` (`AgentSystemPrompt = SDKSystemPrompt`) is
load-bearing in the wrong direction — it tells every adapter to accept the
claude envelope instead of letting every adapter declare its own native system-
prompt handling.

This leak is the remaining structural twin of the
`executeWithAgentSDK`/`mcpServers` leak that `task-make-autonomy-agent-steps-
and-judges-harness-neutr` closed. The previous task removed claude-SDK
*options* (`mcpServers`, `settingSources`, `canUseTool`) from harness-neutral
code. This task removes claude-SDK *prompt structure* from the same seams.

## Desired Outcome

The harness-neutral callers produce portable system-prompt content as a plain
string (or a harness-neutral record whose fields describe intent, not claude-
SDK wire structure). The claude adapter wraps that content in its native
preset shape inside the adapter; non-claude adapters consume the string
directly at their wire boundary without an `append` unwrapper.

Concretely:

- `src/core/workflow/steps/step-executor-agent.ts`,
  `src/core/workflow/repair-loop.ts`, and `src/cli.ts` build portable prompt
  text via a harness-neutral helper (e.g. `buildKotaSystemPrompt` returning
  `string`), not via `buildClaudeCodeSystemPrompt`.
- `AgentHarnessRunOptions.systemPrompt` becomes harness-neutral: either a
  plain string, or an explicitly typed structure that does not carry the
  `type: "preset" | preset: "claude_code"` claude envelope. The decision
  whether to keep a string-only field or a typed harness-neutral record is a
  design choice; the outcome is that claude-SDK wire naming does not leak
  through the protocol.
- The claude-agent-harness adapter constructs its own
  `{ type: "preset", preset: "claude_code", append }` value at the adapter
  boundary, so only claude-specific code knows that wire shape exists.
- The openai-tools and thin adapters drop their `extractSystemText` /
  preset-unwrap branches. Missing-preset rejections (the "bare preset without
  append" error paths) disappear because the preset shape never reaches them.

## Constraints

- No dual path. After the change, no file outside
  `src/modules/claude-agent-harness/` (plus the adapter's own tests) should
  import or construct `{ type: "preset", preset: "claude_code" }`.
- Keep `buildClaudeCodeSystemPrompt`'s content composition — project context,
  instruction context, user profile, skills prompt, autonomous-agent-
  instructions — intact. The behavior change is the returned envelope, not the
  prompt content.
- Do not introduce a parallel harness-neutral prompt module. The portable-text
  builder should live where its inputs already live: alongside the existing
  context/profile loaders in `src/core/` that the current builder already
  imports (`loadProjectContext`, `loadInstructionContext`, `buildUserProfile`).
- Update `src/core/agent-harness/types.ts` so the `AgentSystemPrompt` contract
  describes what a harness-neutral caller delivers, not the claude-SDK wire
  union. If `AgentSystemPrompt = string` is enough, use that; if a richer
  harness-neutral record is justified, document it at
  `src/core/agent-harness/AGENTS.md` with the reason.
- The claude-agent-sdk adapter must continue to deliver the `claude_code`
  preset to the SDK — dropping the preset would change claude runtime
  behavior, which is out of scope. The task is moving where the preset is
  constructed, not whether it is used.
- Do not regress owner-questions, skills prompt, or autonomous-agent-
  instructions composition. Existing autonomy agent-step and judge tests keep
  asserting that these sections reach the adapter.
- Keep tests stubbed — no live adapter calls. Reuse the fake ModelClient /
  stubbed adapter patterns already in
  `src/modules/openai-tools-agent-harness/adapter.integration.test.ts` and
  `src/modules/openai-tools-agent-harness/autonomy-harness-neutral.integration.test.ts`.

## Done When

- `buildClaudeCodeSystemPrompt` is not imported from `src/cli.ts`,
  `src/core/workflow/`, or any other non-claude-adapter path. (Either it is
  renamed / moved into `src/modules/claude-agent-harness/`, or it is replaced
  by a harness-neutral `buildKotaSystemPrompt` that the claude adapter wraps.)
- `src/core/workflow/steps/step-executor-agent.ts` and
  `src/core/workflow/repair-loop.ts` pass a harness-neutral
  `systemPrompt` value through `runAgentHarness`. Grep for
  `preset: "claude_code"` across `src/` returns results only inside
  `src/modules/claude-agent-harness/` (adapter code + its tests).
- `extractSystemText` in `src/modules/openai-tools-agent-harness/adapter.ts`
  and its twin in `src/modules/thin-agent-harness/adapter.ts` drop the preset-
  unwrap branch. Their tests covering "bare preset claude_code" /
  "preset without append" rejection are removed because the code path that
  emitted those values is gone.
- An autonomy agent-step run and an autonomy judge run against a stubbed
  openai-tools adapter (matching the pattern in
  `autonomy-harness-neutral.integration.test.ts`) assert that the
  `systemPrompt` reaching the adapter is a plain string carrying the expected
  portable sections, without any `type: "preset"` envelope.
- `src/core/agent-harness/AGENTS.md` and `src/core/agent-sdk/AGENTS.md` reflect
  the new boundary: portable prompt text is composed in harness-neutral code,
  the claude-specific envelope lives inside the claude adapter, and
  `AgentSystemPrompt` either is `string` or is documented with its new
  harness-neutral shape. No stale mention of "neutral wire types re-export
  claude shapes" for the system-prompt field.
