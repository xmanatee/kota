# Model

This directory contains the `ModelClient` interface, registry, adaptive model routing, and streaming behavior.

- `model-client.ts` — `ModelClient` interface, `ProviderFactoryOptions`, `ResolvedProvider`, and the registry (`registerModelClientFactory`, `createModelClient`).
- Implementations (Anthropic SDK, OpenAI-compatible) live in `src/extensions/model-clients/`.
- Avoid adding provider-specific implementation here; extend the registry through the extension instead.
