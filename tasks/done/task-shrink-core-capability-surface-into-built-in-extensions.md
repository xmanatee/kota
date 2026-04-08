---
id: task-shrink-core-capability-surface-into-built-in-extensions
title: Shrink the core capability surface into built-in extensions
status: done
priority: p1
area: architecture
summary: KOTA has a real extension protocol, but most capability implementation still pools in src/tools and other core buckets. Move cohesive built-in capability packs behind extension boundaries so the core is mainly a host/runtime.
created_at: 2026-04-07T12:00:00Z
updated_at: 2026-04-08T00:30:00Z
---

## Problem

KOTA's architecture now says the core should be small and `extension` should be
the main integration unit, but the runtime shape still looks heavily core-owned:

- `src/tools/index.ts` hardcodes a large built-in capability inventory
- `src/tools/` is still the primary home for many general-purpose capabilities
- several built-in extensions are thin wrappers around large core
  implementations instead of owning the capability themselves

This makes the repository flatter and harder to reason about, and it weakens
the plug-and-play story. Swapping or evolving a capability should feel like
working on an extension, not patching a giant central registry.

## Desired Outcome

The core becomes mainly a host/runtime:

- tool and extension protocols
- extension loading and lifecycle
- workflow runtime
- daemon control plane
- guardrails and store/provider contracts

General-purpose built-in capabilities become extension-owned packs. Their
tools, routes, commands, skills, and tests live with the extension rather than
being scattered across large shared buckets. Adding a new built-in capability
should usually mean adding or extending an extension, not editing a long
hardcoded list in the core.

## Constraints

- Do not explode the repo into one extension per trivial helper. Group by
  cohesive capability, not by file count.
- Do not add compatibility aliases or dual registration paths.
- Keep tool protocol and guardrail metadata explicit and typed.
- This task should establish a durable pattern, not merely move files around.

## Done When

- A clear built-in extension pattern exists in code and docs.
- At least one significant capability family is moved behind an
  extension-owned boundary as the reference implementation.
- `src/tools/index.ts` no longer acts as the primary inventory of
  general-purpose built-in capabilities.
- `src/AGENTS.md`, `src/tools/AGENTS.md`, `src/extensions/AGENTS.md`, and
  `docs/ARCHITECTURE.md` all reflect the minimal-core boundary honestly.
