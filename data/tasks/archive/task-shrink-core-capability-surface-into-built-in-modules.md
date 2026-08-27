---
status: done
---

# Shrink the core capability surface into built-in modules

## Problem

KOTA's architecture now says the core should be small and `module` should be
the main integration unit, but the runtime shape still looks heavily core-owned:

- `src/core/tools/index.ts` hardcodes a large built-in capability inventory
- `src/core/tools/` is still the primary home for many general-purpose capabilities
- several built-in modules are thin wrappers around large core
  implementations instead of owning the capability themselves

This makes the repository flatter and harder to reason about, and it weakens
the plug-and-play story. Swapping or evolving a capability should feel like
working on an module, not patching a giant central registry.

## Desired Outcome

The core becomes mainly a host/runtime:

- tool and module protocols
- module loading and lifecycle
- workflow runtime
- daemon control plane
- guardrails and store/provider contracts

General-purpose built-in capabilities become module-owned packs. Their
tools, routes, commands, skills, and tests live with the module rather than
being scattered across large shared buckets. Adding a new built-in capability
should usually mean adding or extending an module, not editing a long
hardcoded list in the core.

## Constraints

- Do not explode the repo into one module per trivial helper. Group by
  cohesive capability, not by file count.
- Do not add compatibility aliases or dual registration paths.
- Keep tool protocol and guardrail metadata explicit and typed.
- This task should establish a durable pattern, not merely move files around.

## Done When

- A clear built-in module pattern exists in code and docs.
- At least one significant capability family is moved behind an
  module-owned boundary as the reference implementation.
- `src/core/tools/index.ts` no longer acts as the primary inventory of
  general-purpose built-in capabilities.
- `src/AGENTS.md`, `src/core/tools/AGENTS.md`, `src/modules/AGENTS.md`, and
  `docs/ARCHITECTURE.md` all reflect the minimal-core boundary honestly.
