---
status: open
priority: p1
---
# Centralize module scope selection policy

## Problem

memory/scope.ts, history/scope.ts and knowledge/scope.ts contain 423 LOC at
763e14b14. Their resolve and snapshot bodies are token-identical; store creation
and caching genuinely differ. Local-client and HTTP factories repeatedly assemble
the same active/default/explicit scope-selection policy, risking drift and noise.

## Desired Outcome

Move selection and unknown-scope behavior into the existing scope owner and use
it from these three modules' real CLI/local-client/HTTP paths. Keep store factories,
cache lifetimes and module-specific data behavior with their modules. Choose the
smallest interface that makes the three consumers simpler; preserve late active
scope changes and explicit unknown-scope rejection.

## Constraints

Do not create a universal module superclass, new service locator, module-setup
DSL, duplicate scope registry, cross-host global cache or parallel client layer.
Reuse the daemon scope provider and current generated client contracts. Remove
the superseded selection implementations and duplicate selection tests; retain
distinct storage isolation and lifecycle checks.

## How We Will Know

One shared contract proves explicit, active and default selection, late registry
updates and unknown-scope rejection. Each real consumer obtains the right store
without cross-scope/host state leakage; module-specific construction remains
correct. Inspect factories and public entrypoints to prove all three migrated,
and report fewer policy owners and simpler call sites rather than only moved LOC.