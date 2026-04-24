# Model Clients Module

This module owns all `ModelClient` implementations and the provider factory.

- Contains Anthropic SDK and OpenAI-compatible `ModelClient` implementations plus the provider factory.
- The core loop depends only on the `ModelClient` interface in `src/core/model/`. This module registers the factory so the registry resolves to real implementations at runtime.
- `anthropic.ts` is the only file in the repo that imports `@anthropic-ai/sdk` to satisfy a core contract; it owns the `KotaMessage` / `KotaTool` / `KotaThinkingConfig` / `KotaModelResponse` ↔ Anthropic SDK wire-shape translation at the provider seam (see `src/core/agent-harness/AGENTS.md`).
