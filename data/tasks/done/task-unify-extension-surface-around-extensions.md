---
id: task-unify-extension-surface-around-extensions
title: Finish unifying extension discovery and packaging around one extension surface
status: done
priority: p1
area: architecture
summary: KOTA now has a real extension protocol, but discovery and packaging still span plugins, packages, manifests, and foreign extension config. Collapse those into one clear extension story instead of leaving multiple parallel surfaces.
created_at: 2026-03-26T00:00:00Z
updated_at: 2026-04-08T01:30:00Z
---

## Problem

KOTA now has a real `KotaExtension` protocol, but the runtime still exposes
multiple extension stories at once:

- discovered JavaScript files under `.kota/plugins`
- npm packages under `.kota/packages`
- manifest-defined extensions under `.kota/extensions`
- foreign extensions under `foreignExtensions`

These all ultimately describe the same idea — packaged capability — but they
still feel like different products with different packaging and discovery
rules. The docs overstate this migration as complete, which makes the
architecture easier to claim than to understand.

## Desired Outcome

- KOTA exposes one public extension story for packaged capability.
- In-process TypeScript extensions, foreign KEMP extensions, and generated or
  adapted extensions are all explicit variants of the same extension model,
  not separate public abstractions.
- Operator docs, config, and CLI surfaces present one canonical way to install,
  discover, inspect, and reload extensions.
- Built-in features and external integrations use the same extension protocol.

## Constraints

- Do not preserve multiple first-class extension stories for compatibility.
- Keep foreign KEMP support, but treat transport as a variant of the extension
  protocol rather than a second packaging model.
- Keep the runtime typed and explicit.
- Avoid a cosmetic rename that leaves the old conceptual split intact.

## Done When

- Docs and runtime present one canonical extension story.
- Operator-facing discovery/install/reload surfaces no longer talk about
  plugins, packages, manifest extensions, and foreign extensions as peer
  products.
- The loader and discovery path are collapsed behind one explicit extension
  model with adapter variants where necessary.
- A builder can add or reload an extension without having to understand
  multiple parallel packaging concepts.
