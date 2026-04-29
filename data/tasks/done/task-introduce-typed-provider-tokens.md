---
id: task-introduce-typed-provider-tokens
title: Introduce typed provider tokens
status: done
priority: p1
area: architecture
summary: Replace the string-and-unknown provider registry with typed provider tokens so modules declare provider contracts and dependents resolve them without unsafe casts.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-29T05:09:39.680Z
---

## Problem

`ProviderRegistry` stores providers under `type: string` with
`provider: unknown`, and `ModuleContext.registerProvider/getProvider` exposes
the same type-erased shape. This is a direct protocol weakness: modules can
register a provider under a misspelled string or a mismatched shape, and the
caller only finds out later through a cast or runtime failure.

The current registry also keeps several domain provider interfaces in
`src/core/modules/provider-types.ts`, including memory, knowledge, history,
repo tasks, rendering, and model pricing. Some of those are appropriate core
contracts; others are module-owned domains leaking into core because the
registry lacks a typed extension mechanism.

## Desired Outcome

Provider registration becomes token-based and typed:

- A provider contract is declared as a typed token with a stable id and value
  type.
- `registerProvider(token, provider)` verifies the provider against the token's
  TypeScript type at compile time.
- `getProvider(token)` returns the exact provider type without caller casts.
- Module-owned provider contracts can live with their owning module and be
  exported for dependents that declare a module dependency.
- Existing provider accessors migrate to the token model without changing
  runtime behavior.

## Constraints

- Do not break the module dependency rules. If one module consumes another
  module's provider token, the dependency must be declared.
- Do not move every provider type out of core by default. Keep true runtime
  primitives in core; move only module-domain contracts when the ownership is
  clear.
- Preserve existing "missing provider" behavior: some providers throw, some
  return `null`, and those semantics must stay intentional.
- Keep migration incremental but leave a guard that prevents adding new
  string/unknown providers.

## Done When

- A typed `ProviderToken<T>` or equivalent exists and is the preferred registry
  API.
- Existing providers for at least memory, knowledge, history, repo-tasks,
  rendering, model-pricing, transcription, and voice synthesis are migrated or
  have explicit keep-as-is rationale.
- `ModuleContext.registerProvider/getProvider` no longer expose raw
  `string` + `unknown` as the normal path.
- A focused test proves a provider cannot be registered or consumed under the
  wrong type without TypeScript failing.
- A mechanical guard prevents new raw string provider registrations outside a
  compatibility shim.

## Source / Intent

2026-04-28 protocol review found:

- `src/core/modules/provider-registry.ts` stores `ProviderEntry.provider:
  unknown` keyed by string.
- `src/core/modules/module-types.ts` exposes
  `registerProvider(type: string, provider: unknown)` and
  `getProvider<T>(type: string): T | null`.
- Several module-domain contracts are centralized in
  `src/core/modules/provider-types.ts`, which weakens module-first ownership.

External references checked:

- TypeScript narrowing/exhaustiveness guidance supports typed discriminants
  over raw strings.
- typescript-eslint recommends replacing `any` with known interfaces/types or
  `unknown` only at boundaries.

## Initiative

Typed module protocol enforcement: make provider dependencies compile-time
contracts instead of stringly runtime conventions.

## Acceptance Evidence

- Typecheck failure artifact from a deliberate wrong-provider registration.
- Runtime tests showing active provider selection still works for existing
  migrated providers.
- A provider-registry guard or test that fails on new raw string/unknown
  provider registration.

