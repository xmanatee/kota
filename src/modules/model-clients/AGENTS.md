# Model Clients Extension

This extension owns all `ModelClient` implementations and the provider factory.

- `anthropic.ts` — Anthropic SDK-backed `ModelClient`.
- `openai/` — OpenAI-compatible `ModelClient` and translation utilities.
- `factory.ts` — `PROVIDER_PRESETS`, `parseModelString`, `resolveApiKey`, and `createModelClientImpl`.
- `index.ts` — `KotaExtension` definition; registers the factory with the core registry at module load time.

The core loop depends only on the `ModelClient` interface and the registry in `src/model/model-client.ts`.
This extension registers itself as the factory so the registry resolves to real implementations at runtime.
