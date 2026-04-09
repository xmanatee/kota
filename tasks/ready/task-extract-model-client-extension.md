---
id: task-extract-model-client-extension
title: Extract model client implementations into a dedicated extension
status: ready
priority: p2
area: architecture
summary: Model client implementations (openai, anthropic, etc.) and related adapters are scattered across src/ core files. Extracting them into an extension would reduce core scope and allow model providers to be swapped/extended without touching core.
created_at: 2026-04-09T06:35:00Z
updated_at: 2026-04-09T06:48:22Z
---

## Problem

KOTA's agent loop depends on a pluggable `ModelClient` interface but all implementations
(OpenAI, Anthropic, etc.) live in core files (`openai-model-client.ts`, adapter code, etc.).
Model providers are implementation detail that could live in an extension while the core loop
only depends on the interface.

## Desired Outcome

A new `src/extensions/model-clients/` extension that:

- Owns all `ModelClient` implementations (OpenAI, Anthropic, etc.)
- Registers available model clients in a registry
- Exports the `selectModelClient` logic based on model name/provider config
- Is loaded early so the loop can depend on it

The core loop imports only the interface and uses the registry to find a client for a given
model string. Configuration via `config.models` determines which clients are loaded.

## Constraints

- No change to `ModelClient` interface.
- Model selection logic in the loop must work unchanged.
- All existing model provider behavior is preserved.

## Done When

- `src/extensions/model-clients/` exists with all implementations.
- Core model client files are removed.
- Loop imports only the interface and uses the registry.
- All existing model providers work unchanged.
- Model selection based on config works.
- Tests pass.

