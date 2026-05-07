---
title: Introduce a per-harness preset abstraction so a single switch flips harness + models + tiers + effort coherently
created_at: 2026-05-07T00:00:00.000Z
source: owner
---

Owner intent:

Operator wants to be able to run KOTA against any registered harness (claude-
agent-sdk, codex, gemini, vercel, thin, openai-tools) by changing one switch —
a `--preset <name>` CLI flag or a `config.defaultPreset` value — and have
every other model decision (default model, fast/balanced/capable tier
mapping, default reasoning effort, required env vars) follow automatically.
Driver: imminent migration off Claude as the default day-to-day driver and
toward Codex / Gemini for parts of the autonomy fleet, with no per-call-site
edits to swap providers.

Owner phrasing (reproduced verbatim, do not normalize away):

> хочется абстрагироваться от харнеса, моделей и всего такого. […]
> запускаться, иметь возможность запускаться с любым харнесом. […] чтобы я
> точно так же мог менять на кодекс, использовал себе кодекс. То есть, чтобы
> у меня все […] части моделей и все такое, они были административными по
> отношению к конкретному [харнесу] и моделям.

Goal:

Make the `(harness, models, effort)` tuple a first-class named bundle. One
switch. No silent fallback to Claude-shaped defaults when the active harness
is codex or gemini.

## Current state

- `src/core/agent-harness/` is harness-neutral and well-architected
  (registry, capability flags, hook surface, neutral wire types).
- `KotaConfig` already has `defaultAgentHarness`, `model`, `editorModel`,
  `modelTiers: { fast, balanced, capable }`, `agentModels: Record<agent,
  modelString>`. The fields are independent: switching `defaultAgentHarness`
  does not retarget `model`, tiers, or any per-agent override.
- `src/core/model/model-router.ts` ships `DEFAULT_MODEL_TIERS` whose values
  are all Claude IDs (`claude-haiku-4-5-20251001` / `claude-sonnet-4-6` /
  `claude-opus-4-7`). When `modelTiers` is unset (most users), every
  delegate routes through Claude IDs regardless of `defaultAgentHarness`.
- `src/cli.ts` defaults to `"claude-sonnet-4-6"` in three places; pipe path,
  run path, and the legacy `modelProvider.type === "agent-sdk"` branch.
- `src/core/tools/delegate-config.ts:42` initializes the singleton with
  `model: "claude-opus-4-7"`.
- `src/modules/autonomy/shared.ts:50` declares `AUTONOMY_AGENT_DEFAULTS`
  with `model: "claude-opus-4-7"` as the single source of truth for the
  autonomy fleet.
- Six adapters ship: `claude-agent-sdk`, `codex`, `gemini`, `vercel`,
  `thin`, `openai-tools`. Each adapter handles its own auth env var
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` for codex+openai-tools,
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` for gemini), reasoning-effort
  translation, and per-step option validation.

## Proposed shape (research-grounded — see "Research notes" below)

Add a `Preset` record that bundles every field a switch must flip together:

```ts
type PresetId = string;             // 'claude' | 'codex' | 'gemini' | …

type Preset = {
  id: PresetId;
  description: string;
  harness: string;                  // registered harness name
  authEnv: readonly string[];       // required env vars; preflighted at load
  defaultModel: string;             // canonical id passed to the SDK
  tiers: { fast: string; balanced: string; capable: string };
  defaultEffort: AgentEffort;       // 'low'|'medium'|'high'|'xhigh'|'max'
  // Optional: `effortMap` lives in adapter, not here — translation already
  // happens at the harness seam (codex, gemini AGENTS.md make this explicit).
};
```

A `presetRegistry` exports the shipped presets (`claude`, `codex`, `gemini`,
`vercel`, `openai-tools`, `thin`) and accepts user-defined entries from
config. A new top-level config field `presets: Record<PresetId, Preset>`
merges with shipped defaults; `defaultPreset: PresetId` and the `--preset
<id>` CLI flag pick the active one. Resolution priority follows the
gemini-cli convention: CLI flag > env (`KOTA_PRESET`) > project config >
user config > shipped default. No implicit fallback to `claude` unless a
preset literally named `claude` is the configured default.

Once a preset is selected, every model decision queries the preset:

- `resolveDefaultModel(preset)` → preset.defaultModel
- `resolveTierModel(preset, tier)` → preset.tiers[tier]
- `resolveDefaultEffort(preset)` → preset.defaultEffort
- `resolveHarness(preset)` → registered harness named by preset.harness

`config.model` becomes a per-preset override
(`config.modelOverrides[presetId]?: { default?, tiers?, effort? }`) so
operators can pin a specific Claude or Codex model without leaving the
preset abstraction. `config.agentModels` migrates from
`Record<agent, modelString>` to `Record<agent, ModelTier | string>`; tier
names resolve through the preset, raw strings keep working but emit a
`config-warning` when the string is not in the active preset's catalog.

## Done when

- A `Preset` type and shipped registry exist in `src/core/model/preset.ts`
  (or sibling), declared and tested independent of any specific adapter.
- `--preset <id>` CLI flag + `config.defaultPreset` honored across `kota
  run`, `kota run -i`, pipe input, daemon mode, autonomy workflows.
- Every production call site that today reads a literal `claude-*` model
  string instead asks the active preset (see sibling task
  `task-eradicate-hardcoded-claude-model-defaults`). `DEFAULT_MODEL_TIERS`
  in `model-router.ts` is dropped or scoped to a single shipped preset's
  tiers — never imported as a global default.
- `validate-agent-step.ts`'s `VALID_MODEL_IDS` is preset-derived (sibling
  task `task-replace-workflow-agent-step-model-allowlist-with-preset`).
- `kota doctor` reports `preset: codex — OPENAI_API_KEY: missing` instead
  of letting the run fail mid-call. `authEnv` is preflighted on
  preset selection and the failure message names the preset and the
  missing var.
- A switch from `claude` → `codex` → `gemini` is observable as one config
  diff (or one flag), and the announce-active-harness banner shows
  `kota [codex] gpt-5-codex` instead of a hardcoded model string.
- `agentModels` accepts tier names; raw model strings are still allowed
  but warn when the value is not present in the active preset's catalog.
  Migration of in-tree autonomy `AgentDef` entries to tier names lands in
  the same change; nothing in the autonomy module pins a literal Claude
  model id.

## Acceptance evidence

- `.kota/runs/<run-id>/` transcripts captured for one autonomy turn under
  each of `--preset claude`, `--preset codex`, `--preset gemini`. The
  active-harness banner and the actual model id sent to each provider
  must appear in the transcript and must match the preset's `defaultModel`
  unless overridden.
- A unit test enumerates the shipped presets and asserts every one
  resolves a non-empty `defaultModel`, `tiers.{fast,balanced,capable}`,
  and `authEnv` array; no preset entry inherits a value from another by
  accident (no `claude` leakage when codex tiers are partially set).
- `kota doctor --preset codex` exits non-zero with a single line naming
  `OPENAI_API_KEY` when the env var is unset, and exits zero when it is
  set. Same shape for `gemini` (GEMINI_API_KEY / GOOGLE_API_KEY).

## Constraints

- Strict by default (`AGENTS.md`): no `?? "claude-sonnet-4-6"` fallbacks
  inside production code paths once the preset abstraction lands. If the
  preset cannot resolve a model, fail loudly with the preset id named.
- No legacy: the existing `model`, `editorModel`, `modelTiers`,
  `agentModels` fields stay where their meaning is preset-scoped, but
  `config.model = "claude-sonnet-4-6"` must not silently override a
  `defaultPreset = "codex"` selection. Decide whether top-level `model`
  becomes `config.modelOverrides[presetId].default` or stays as a flat
  override on the active preset; either is fine, but pick one and delete
  the other path.
- Adapters keep ownership of their effort translation
  (`src/modules/codex-agent-harness/AGENTS.md` and
  `src/modules/gemini-agent-harness/AGENTS.md` are explicit that effort
  mapping lives at the adapter seam). Presets only carry the *neutral*
  `AgentEffort` literal; adapters translate it.
- Built-in presets ship as data, not in code: shipped registry lives in
  one file (e.g. `src/core/model/preset-registry.ts`) and is the only
  place new model ids land when a vendor releases a new tier.

## Research notes

External primary docs (read before implementing — pitfalls below come
from real bugs in the wild):

- **Vercel AI SDK** — `customProvider({ languageModels })` +
  `createProviderRegistry`. Cleanest TS expression of the
  preset-as-named-aliases pattern. Each provider entry exposes `fast`,
  `balanced`, `capable` (or any free-form alias name); callers reference
  `'codex:fast'` and the SDK resolves to the concrete model. URL:
  https://ai-sdk.dev/docs/ai-sdk-core/provider-management
- **Roo Code** — first-class "API Configuration Profile" bundling
  provider + apiKey + model + temperature + thinkingBudget per profile;
  bound to a Mode (Architect/Code/Ask). URL:
  https://docs.roocode.com/features/api-configuration-profiles
- **LiteLLM** — `router_settings.model_group_alias` maps an alias name
  (e.g. `gpt-4`) to N concrete deployments with retry/failover. URL:
  https://docs.litellm.ai/docs/routing
- **Aider** — `--model` + `--weak-model` + `--editor-model`, plus
  `accepts_settings: [reasoning_effort, thinking_tokens]` capability
  flags per model entry. Capability flags belong on the model, not the
  harness. URLs:
  https://aider.chat/docs/config/adv-model-settings.html
  https://aider.chat/docs/config/reasoning.html
- **Continue.dev** — `models[]` with `roles: [chat, edit, apply,
  autocomplete, embed, rerank, summarize]`. Useful structural precedent;
  KOTA's tier shape is closer to Vercel/OpenCode/Roo than Continue's
  role-array. URL: https://docs.continue.dev/customize/model-roles
- **Claude Code Router** — slot-shaped router (`default`, `background`,
  `think`, `longContext`, `webSearch`, `image`) with auto-routing
  heuristics (token count, keyword). Worth keeping in mind as a future
  extension once basic presets work. URL:
  https://github.com/musistudio/claude-code-router
- **OpenAI Agents SDK** — `OPENAI_DEFAULT_MODEL` env, `RunConfig.model`,
  custom `ModelProvider`. URL:
  https://openai.github.io/openai-agents-python/models/
- **Gemini CLI** — `--model` > env > settings.json > default; documented
  bug shipping a hardcoded `DEFAULT_GEMINI_MODEL` that overrode
  `settings.json`. Direct precedent for KOTA's current pitfall — every
  hardcoded `claude-*` literal in our adapters and CLI is the same bug.
  URL: https://github.com/google-gemini/gemini-cli/issues/5373

## Pitfalls (from those projects' incident histories)

1. **Hardcoded default models in the harness/CLI layer survive
   refactors.** Same shape as Gemini CLI #5373. Grep for any literal
   `claude-*`, `gpt-*`, `gemini-*` outside the shipped preset registry
   and the per-adapter pricing/probe tables — every hit is a regression
   waiting to happen.
2. **Reasoning-effort doesn't translate cleanly across providers.**
   Anthropic uses `thinking: { type, budget_tokens }`; OpenAI uses
   `reasoning.effort: low|medium|high`; Gemini uses `thinkingBudget`
   (token count). Capability flags (does this model accept
   reasoning-effort at all?) belong on the model, not the harness. The
   `AgentEffort` literal already lives in
   `src/core/agent-harness/types.ts`; preset stores neutral effort,
   adapters translate, and adapters refuse if the resolved model can't
   honor it.
3. **Tier-mapping rot.** When Sonnet 4.6 → 4.7 ships, every hardcoded
   tier in code needs a release. Put the mapping in *data*. Shipped
   preset registry is one file; user override is in `~/.kota/config.json`.
4. **Agent-level overrides creep into model-string land.** OpenCode's
   `agent.<name>.model: "anthropic/claude-sonnet-4-5"` defeats the
   abstraction the moment the user switches preset. KOTA's
   `agentModels` field has this exact shape today. Migrate in-tree
   autonomy entries to tier names; allow raw strings only with a
   `config-warning` when the value is foreign to the active preset.
5. **Env-var sprawl.** Declare `authEnv` *inside* the preset entry so
   the doctor preflight is mechanical, not a separate per-provider
   case statement.
6. **Fallback semantics differ silently.** Gemini CLI silently falls
   back pro→flash on overload; Vercel passes unknown aliases through.
   For a coding agent, fail loudly is the only safe default — silent
   downgrades produce results the user can't reproduce.
7. **Preset stickiness.** Mid-task preset switches produce confusing
   transcripts. Record `presetId` (and the resolved model) in run
   state at run-start so resume/replay is deterministic. KOTA's run
   store already records `model`; add `presetId` alongside.

## Scope notes

- Do not bundle this with the cross-preset parity gate (sibling task
  `task-add-cross-preset-runtime-parity-gate`). The parity gate
  consumes the preset abstraction; it must not be its first reader.
- Sibling task `task-eradicate-hardcoded-claude-model-defaults`
  inventories every literal `claude-*` outside the preset registry and
  rewrites consumers; it lands after this task so each consumer has
  somewhere to read its default from.
- Sibling task
  `task-replace-workflow-agent-step-model-allowlist-with-preset`
  unblocks codex/gemini workflow agent steps; trivially small, can land
  in parallel.

## Out of scope

- Multi-deployment routing inside one preset (LiteLLM-style failover
  groups). KOTA already has `failover-client.ts`; revisit only if the
  preset abstraction surfaces a real need.
- Per-task `Preset` swap mid-run. Pin `presetId` at run-start; switching
  is a new run.
- Auto-pricing / cost-aware routing. Out of scope per
  `feedback_no_cost_bias_in_autonomy` — autonomy must not see cost
  signals.
