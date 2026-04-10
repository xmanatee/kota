# Model Clients Module

This module owns all `ModelClient` implementations and the provider factory.

- Contains Anthropic SDK and OpenAI-compatible `ModelClient` implementations plus the provider factory.
- The core loop depends only on the `ModelClient` interface in `src/core/model/`. This module registers the factory so the registry resolves to real implementations at runtime.
