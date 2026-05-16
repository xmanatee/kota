# Model Clients Module

This module owns all `ModelClient` implementations and the provider factory.

- Contains Anthropic SDK and OpenAI-compatible `ModelClient` implementations plus the provider factory.
- The core loop depends only on the `ModelClient` interface in `src/core/model/`. This module registers the factory so the registry resolves to real implementations at runtime.
- `anthropic.ts` is the only file in the repo that imports `@anthropic-ai/sdk` to satisfy a core contract; it owns the `KotaMessage` / `KotaTool` / `KotaThinkingConfig` / `KotaModelResponse` ↔ Anthropic SDK wire-shape translation at the provider seam (see `src/core/agent-harness/AGENTS.md`).
- Owns per-model token pricing for the providers it ships against. `onLoad` registers a `ModelPricingProvider` via the typed `MODEL_PRICING_PROVIDER_TOKEN`; core resolves it through `getModelPricingProvider()` in `#core/modules/provider-registry.js`. Adding a shipped model means adding pricing coverage or an explicit unpriced status in this module — never a core pricing table. Models without a registered pricing row contribute $0 to `CostTracker.addUsage` by design (no silent peer-model fallback).
