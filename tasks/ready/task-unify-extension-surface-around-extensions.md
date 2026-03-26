---
id: task-unify-extension-surface-around-extensions
title: Unify modules, plugins, and manifests into one extension surface
status: ready
priority: p0
area: architecture
summary: KOTA currently exposes overlapping extension stories through modules, plugins, and manifest modules. Collapse them into one `extension` model that can contribute tools, skills, agents, workflows, channels, and internal services.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA has multiple public extension surfaces that overlap heavily:

- `KotaModule`
- discovered plugins under `.kota/plugins` and `.kota/packages`
- manifest-defined modules and scripts

They all ultimately contribute similar things, but they present different
mental models, loaders, and terminology. This makes the system harder to learn,
extend, and simplify.

## Desired Outcome

- KOTA exposes one public `extension` concept for packaged capability.
- An extension can contribute tools, skills, agents, workflows, channels, and
  internal services.
- Built-in features and external integrations use the same extension protocol.
- Manifest-based or generated definitions do not remain a separate public
  runtime concept.

## Constraints

- Do not preserve multiple first-class extension stories for compatibility.
- Keep the runtime typed and code-defined.
- Avoid a cosmetic rename that leaves the old conceptual split intact.

## Done When

- A single extension protocol exists and is documented in code and docs.
- Module/plugin/manifest loading paths are collapsed behind that protocol.
- Public naming, loader behavior, and help/docs no longer present multiple
  extension abstractions for the same job.
