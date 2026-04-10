# Model

This directory contains the `ModelClient` interface, registry, adaptive model routing, and streaming behavior.

- Implementations (Anthropic SDK, OpenAI-compatible) live in `src/modules/model-clients/`.
- Avoid adding provider-specific implementation here; extend the registry through the module instead.
