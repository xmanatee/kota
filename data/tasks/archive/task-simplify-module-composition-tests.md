---
status: done
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

## Completion

Shared test setup now uses the real loader and owned teardown; reset-all helpers
and the fake rendering provider were removed. Event/session and commands-mode
cases were consolidated without replacing real foreign subprocess boundaries.
Direct filesystem/composition consumers release their loaders explicitly.

Frozen-recipe candidate counts: core/modules tests 7,422 → 7,053 (-369), support
219 → 179 (-40); changed direct-consumer tests 588 → 597 (+9). No production or
exclusion changes. This completes the bounded owner slice, not the parent's
published aggregate reduction target.

`pnpm check:fast` passed. Final selected verification passed 420 tests, including
loader, stdio, health, resilience and direct composition consumers. Eight HTTP
cases could not complete in the sandbox (loopback listen EPERM and demo startup
failure). The precedence execution failure also reproduces with the original
fixture/loader; its collision case passes. No change-induced failure remains
observed. Details, per-file counts and logs are in builder run
`2026-09-12T06-41-25-438Z-builder-xstt9d`, agent artifact `summary.md`.
