---
id: task-introduce-harness-preset-abstraction
title: Introduce harness preset abstraction
status: done
priority: p1
area: architecture
summary: Introduce a Preset abstraction so changing one switch flips harness, default model, fast/balanced/capable tiers, and default effort coherently across CLI, daemon, and autonomy.
created_at: 2026-05-07T23:33:16.214Z
updated_at: 2026-05-08T00:28:14.672Z
---

## Problem

`KotaConfig` already exposes `defaultAgentHarness`, `model`, `editorModel`,
`modelTiers: { fast, balanced, capable }`, `agentModels: Record<agent,
modelString>`, but the fields are independent: switching
`defaultAgentHarness` does not retarget `model`, tiers, or any per-agent
override. `src/core/model/model-router.ts` ships `DEFAULT_MODEL_TIERS`
whose values are all Claude IDs (`claude-haiku-4-5-20251001` /
`claude-sonnet-4-6` / `claude-opus-4-7`), so when `modelTiers` is unset
(the common case) every delegate routes through Claude IDs regardless of
`defaultAgentHarness`. `src/cli.ts` defaults to `"claude-sonnet-4-6"` in
three places; `src/core/tools/delegate-config.ts:42` initializes the
singleton with `model: "claude-opus-4-7"`; `src/modules/autonomy/shared.ts:50`
declares `AUTONOMY_AGENT_DEFAULTS` with `model: "claude-opus-4-7"` as the
single source of truth for the autonomy fleet.

Result: an operator who flips harness still ships Claude-shaped model ids
to OpenAI/Gemini SDKs.

## Desired Outcome

Make the `(harness, models, effort)` tuple a first-class named bundle. A
single switch — `--preset <name>` CLI flag or `config.defaultPreset` —
flips harness, default model, fast/balanced/capable tier mapping, default
reasoning effort, and auth contract together. No silent fallback to
Claude-shaped defaults when the active preset is codex or gemini.

Proposed shape:

```ts
type PresetId = string;             // 'claude' | 'codex' | 'gemini' | …

type Preset = {
  id: PresetId;
  description: string;
  harness: string;                  // registered harness name
  authEnv: readonly string[];       // env auth alternates; [] = harness-managed auth
  defaultModel: string;             // canonical id passed to the SDK
  tiers: { fast: string; balanced: string; capable: string };
  defaultEffort: AgentEffort;       // 'low'|'medium'|'high'|'xhigh'|'max'
};
```

Resolution priority (gemini-cli convention): CLI flag > env
(`KOTA_PRESET`) > project config > user config > shipped default. No
implicit fallback to `claude` unless `claude` is the configured default.

## Constraints

- Strict by default: no `?? "claude-sonnet-4-6"` fallbacks inside
  production code paths once the preset abstraction lands. If preset
  resolution returns nothing, fail loudly with the consumer named.
- No legacy: `config.model = "claude-sonnet-4-6"` must not silently
  override a `defaultPreset = "codex"` selection. Decide whether
  top-level `model` becomes `config.modelOverrides[presetId].default` or
  stays as a flat override on the active preset; pick one and delete the
  other path.
- Adapters keep ownership of effort translation (`codex-agent-harness`
  and `gemini-agent-harness` AGENTS.md are explicit that effort mapping
  lives at the adapter seam). Presets carry the *neutral* `AgentEffort`
  literal; adapters translate.
- Built-in presets ship as data: shipped registry lives in one file
  (e.g. `src/core/model/preset-registry.ts`) and is the only place new
  model ids land when a vendor releases a new tier.
- Per `feedback_no_cost_bias_in_autonomy`: do not introduce cost-aware
  routing logic. Tier mapping is preset-data, not autonomy-runtime.

## Done When

- A `Preset` type and shipped registry exist in `src/core/model/preset.ts`
  (or sibling), declared and tested independent of any specific adapter.
- `--preset <id>` CLI flag + `config.defaultPreset` honored across `kota
  run`, `kota run -i`, pipe input, daemon mode, autonomy workflows.
- Every production call site that today reads a literal `claude-*` model
  string instead asks the active preset (sibling
  `task-eradicate-hardcoded-claude-model-defaults`).
  `DEFAULT_MODEL_TIERS` in `model-router.ts` is dropped or scoped to a
  single shipped preset's tiers — never imported as a global default.
- `validate-agent-step.ts`'s `VALID_MODEL_IDS` is preset-derived (sibling
  `task-replace-workflow-agent-step-model-allowlist-with-p`).
- `kota doctor` reports harness-managed auth for codex and missing env vars
  for env-auth presets before a run fails mid-call.
- A switch from `claude` → `codex` → `gemini` is observable as one
  config diff (or one flag); the announce-active-harness banner shows
  `kota [codex] gpt-5.5` instead of a hardcoded model string.
- `agentModels` accepts tier names; raw model strings are still allowed
  but warn when the value is not present in the active preset's catalog.
  Migration of in-tree autonomy `AgentDef` entries to tier names lands
  in the same change.
- A unit test enumerates the shipped presets and asserts every one
  resolves a non-empty `defaultModel`, `tiers.{fast,balanced,capable}`,
  and `authEnv` array; no preset entry inherits a value from another by
  accident.

## Source / Intent

Owner phrasing (verbatim, do not normalize, from inbox capture
2026-05-07):

> хочется абстрагироваться от харнеса, моделей и всего такого. […]
> запускаться, иметь возможность запускаться с любым харнесом. […]
> чтобы я точно так же мог менять на кодекс, использовал себе кодекс.
> То есть, чтобы у меня все […] части моделей и все такое, они были
> административными по отношению к конкретному [харнесу] и моделям.

Driver: imminent migration off Claude as the default day-to-day driver
and toward Codex / Gemini for parts of the autonomy fleet, with no
per-call-site edits to swap providers.

External primary docs read before implementing (pitfalls below come from
real bugs in the wild):

- Vercel AI SDK `customProvider` + `createProviderRegistry`:
  https://ai-sdk.dev/docs/ai-sdk-core/provider-management
- Roo Code "API Configuration Profile":
  https://docs.roocode.com/features/api-configuration-profiles
- LiteLLM `router_settings.model_group_alias`:
  https://docs.litellm.ai/docs/routing
- Aider model settings + reasoning:
  https://aider.chat/docs/config/adv-model-settings.html
  https://aider.chat/docs/config/reasoning.html
- Continue.dev `models[].roles`:
  https://docs.continue.dev/customize/model-roles
- Claude Code Router: https://github.com/musistudio/claude-code-router
- OpenAI Agents SDK models: https://openai.github.io/openai-agents-python/models/
- Gemini CLI hardcoded-default bug:
  https://github.com/google-gemini/gemini-cli/issues/5373

Pitfalls drawn from those projects' incident histories:

1. Hardcoded default models in the harness/CLI layer survive refactors
   (Gemini CLI #5373 is the same shape as KOTA's current literal
   `claude-*` strings).
2. Reasoning-effort doesn't translate cleanly across providers
   (Anthropic `thinking.budget_tokens`, OpenAI `reasoning.effort`,
   Gemini `thinkingBudget`). Capability flags belong on the model, not
   the harness.
3. Tier-mapping rot — put the mapping in *data*.
4. Agent-level overrides creep into model-string land — migrate
   in-tree autonomy entries to tier names; allow raw strings only with
   a warning when foreign to the active preset.
5. Env-var sprawl — declare `authEnv` *inside* the preset entry.
6. Fallback semantics differ silently — fail loudly is the only safe
   default.
7. Preset stickiness — record `presetId` in run state at run-start so
   resume/replay is deterministic.

## Initiative

Harness-preset migration: one switch flips harness + models + tiers +
effort coherently. Sibling tasks consume this abstraction:
`task-replace-workflow-agent-step-model-allowlist-with-p`,
`task-eradicate-hardcoded-claude-model-defaults`,
`task-add-cross-preset-runtime-parity-gate`.

## Acceptance Evidence

- `.kota/runs/<run-id>/` transcripts captured for one autonomy turn
  under each of `--preset claude`, `--preset codex`, `--preset gemini`.
  The active-harness banner and the actual model id sent to each
  provider must appear in the transcript and must match the preset's
  `defaultModel` unless overridden.
- A unit test enumerating the shipped presets and asserting every one
  resolves a non-empty `defaultModel`, `tiers.{fast,balanced,capable}`,
  and explicit `authEnv` array.
- `kota doctor --preset codex` exits zero with harness-managed auth; env-auth
  presets such as `gemini` still fail loudly when all alternates are unset.

## Out of Scope

- Multi-deployment routing inside one preset (LiteLLM-style failover
  groups). KOTA already has `failover-client.ts`; revisit only if the
  preset abstraction surfaces a real need.
- Per-task `Preset` swap mid-run. Pin `presetId` at run-start; switching
  is a new run.
- Auto-pricing / cost-aware routing. Out of scope per
  `feedback_no_cost_bias_in_autonomy`.
- The cross-preset parity gate (sibling task) — that consumes this
  abstraction and must not be its first reader.
