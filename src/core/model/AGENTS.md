# Model

This directory contains the `ModelClient` interface, registry, adaptive model
routing, the `Preset` abstraction, and streaming behavior.

- Implementations (Anthropic SDK, OpenAI-compatible) live in
  `src/modules/model-clients/`.
- Avoid adding provider-specific implementation here; extend the registry
  through the module instead.
- `preset.ts` is the single shipped registry of `(harness, defaultModel,
  tiers, defaultEffort, authEnv)` bundles. `authEnv: []` means the harness
  authenticates through its own local login state and its adapter readiness
  must expose a non-network auth probe. New model ids land here when a vendor
  releases a tier; do not duplicate the mapping at consumer sites.
- Resolution priority: `--preset` flag > `KOTA_PRESET` env > `config.defaultPreset`
  > shipped default. An explicitly named preset that does not exist throws
  loudly instead of falling through.
- `DEFAULT_MODEL_TIERS` in `model-router.ts` is the shipped default preset's tiers
  surfaced for legacy callers; consumers should query the active preset via
  `mergePresetTiers(preset, overrides)` instead of importing the constant
  directly.
