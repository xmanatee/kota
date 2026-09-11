---
status: open
priority: p1
depends_on: [task-prove-seventy-percent-test-loc-reduction]
---

# Simplify module composition verification without fake module runtimes

## Scope

Own `src/core/modules` (7,027 test LOC) and its directly used support. Start with
`module-loader.test.ts` (1,916), provider registry and foreign-module lifecycle
tests. Capability modules and channels remain consumers of these real owners.

## Required Outcome

Keep contribution validation, registration collisions, load/unload ownership,
failure isolation, foreign transport and revision-sensitive policy behavior.
Replace repeated loader setup and copied contribution catalogs with representative
typed modules using the production loader. Test each meaningful lifecycle failure
once; do not remove a real out-of-process boundary because a mocked one passes.

Inspect reset helpers and fake provider registries for duplicated semantics. Reuse
the real owning composition with controlled external ports; no new module-test DSL,
module-specific copy of shared guarantees or test-only production exports.

## Acceptance

Apply `task-verify-fifty-percent-test-reduction` rules. Publish a module-owner
simplification with focused loader/transport evidence, clean direct consumers
and measured test/support delta. Do not redesign module declarations, channels
or the daemon to satisfy a LOC goal.
