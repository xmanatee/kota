---
id: task-extract-provider-isolation-extension
title: Extract provider registry and access patterns into a dedicated extension
status: ready
priority: p2
area: architecture
summary: The provider registry, initialization, and access patterns are scattered across src/ core files (providers.ts, secret-providers.ts, extension-context.ts). Consolidating these into a focused extension would clarify the boundary and reduce core responsibilities.
created_at: 2026-04-09T06:31:00Z
updated_at: 2026-04-09T06:31:00Z
---

## Problem

KOTA's runtime state subsystem (stores) is backed by pluggable providers (memory backends,
knowledge stores, history persistence, task sources). The provider registry and initialization
live in core files (`src/providers.ts`, `src/secret-providers.ts`) that are imported by the
loop, extensions, and CLI. This creates a core dependency on implementation detail when the
registry is really a coordination point that extensions should own.

The current pattern is: core maintains the registry, extensions register themselves. A clearer
pattern would be: a focused `providers` extension maintains the registry, initialization, and
access helpers, and other subsystems import from it as a well-defined seam.

## Desired Outcome

A new `src/extensions/providers/` extension that:

- Owns `ProviderRegistry` class and singleton accessors (`getProviderRegistry`, `resetProviderRegistry`)
- Exports provider initialization logic (`initProviders`, `loadProviders`)
- Exports convenience getters for the common case (`getTaskProvider`, `getMemoryProvider`, etc.)
- Exports `ProviderRegistry.register()` and other public APIs
- Is loaded first (topologically) so other extensions can depend on it
- Has no direct dependencies on other extensions except the registry interface

Other extensions continue to register their providers via the context, but import the registry
API from `kota/provider-context` or similar re-export rather than directly from core.

The core retains only the `ProviderRegistry` interface definition (`src/provider-types.ts`) and
imports providers from the extension when needed in the loop.

## Constraints

- No change to provider interface definitions or registration patterns.
- All existing provider load/access behavior must work unchanged.
- The extension must load before any other extension that registers a provider.
- Core imports of the registry are updated to use the extension's export.

## Done When

- `src/extensions/providers/` exists and exports provider access/registry APIs.
- Core `providers.ts` and `secret-providers.ts` are removed or minimal.
- All extensions that register providers continue to work.
- Provider initialization during daemon startup works unchanged.
- Loop and CLI code that accesses the registry import from the extension.
- All tests pass.

