---
id: task-unify-module-surface-around-modules
title: Finish unifying module discovery and packaging around one module surface
status: done
priority: p1
area: architecture
summary: KOTA now has a real module protocol, but discovery and packaging still span plugins, packages, manifests, and foreign module config. Collapse those into one clear module story instead of leaving multiple parallel surfaces.
created_at: 2026-03-26T00:00:00Z
updated_at: 2026-04-08T01:30:00Z
---

## Problem

KOTA now has a real `KotaModule` protocol, but the runtime still exposes
multiple module stories at once:

- discovered JavaScript files under `.kota/plugins`
- npm packages under `.kota/packages`
- manifest-defined modules under `.kota/modules`
- foreign modules under `foreignModules`

These all ultimately describe the same idea — packaged capability — but they
still feel like different products with different packaging and discovery
rules. The docs overstate this migration as complete, which makes the
architecture easier to claim than to understand.

## Desired Outcome

- KOTA exposes one public module story for packaged capability.
- In-process TypeScript modules, foreign KEMP modules, and generated or
  adapted modules are all explicit variants of the same module model,
  not separate public abstractions.
- Operator docs, config, and CLI surfaces present one canonical way to install,
  discover, inspect, and reload modules.
- Built-in features and external integrations use the same module protocol.

## Constraints

- Do not preserve multiple first-class module stories for compatibility.
- Keep foreign KEMP support, but treat transport as a variant of the module
  protocol rather than a second packaging model.
- Keep the runtime typed and explicit.
- Avoid a cosmetic rename that leaves the old conceptual split intact.

## Done When

- Docs and runtime present one canonical module story.
- Operator-facing discovery/install/reload surfaces no longer talk about
  plugins, packages, manifest modules, and foreign modules as peer
  products.
- The loader and discovery path are collapsed behind one explicit module
  model with adapter variants where necessary.
- A builder can add or reload an module without having to understand
  multiple parallel packaging concepts.
