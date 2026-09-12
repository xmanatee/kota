---
status: done
---

# Reduce daemon-control and scope test duplication at real boundaries

## Scope And Starting Evidence

`src/core/daemon` retains 20,797 test LOC. Start with `daemon-control.test.ts`
(2,546), `scope-onboarding.test.ts` (2,232), daemon-chat composition and adjacent
test support. Do not redo the workflow kernel, module loader, operator clients,
or top-level journeys owned by other children.

## Required Outcome

Separate authorization/routing, scope lifecycle and daemon ownership contracts.
Test shared request authorization once at the server boundary, keeping endpoint
tests for their domain-specific behavior. Preserve representative real HTTP/SSE
composition and scope/credential isolation; mocked handler returns cannot prove
those boundaries. Remove redundant route catalogs, copied state setups and private
handle assertions only where the owner already provides equivalent protection.

For source/build and multi-scope variants, retain only distinct packaging or
authority failures, not each permutation. Keep duplicate-process exclusion,
runtime activation, owner pause and recovery observations. Record newly found
runtime defects separately when they exceed this cleanup's coherent scope.

## Acceptance

Use the shared rules in `task-verify-fifty-percent-test-reduction`. Publish a
reviewed daemon-only simplification, affected boundary checks, and before/after
test/support numbers. Public client behavior must remain unchanged; lower LOC
alone is not acceptance.

## Completion

Consolidated daemon-control authorization at the server dispatch boundary, removed
exact duplicate scope-selector checks, combined onboarding route replanning and
run-filter projections, and reused per-test handles for route-only overrides.
Chat HTTP composition now combines creation/list projection and restart/wake/delete
observations; mode validation remains with session-create. Distinct onboarding
rollback, authority, filesystem substitution, multi-scope, SSE, process exclusion,
activation, owner pause and recovery checks remain intact. Production behavior,
client contracts and shared support are unchanged.

Using the frozen counting recipe on this candidate: daemon executable tests
21,392 → 20,915 LOC (477 removed); authored support 684 → 684; changed production
and exclusions 0. The two changed suites are 2,518 → 2,145 and 960 → 856 LOC.
These local counts do not establish published aggregate reduction.

Validation: pnpm check:fast passed and nine affected/retained owner suites passed
113 tests. The focused real HTTP/SSE run was attempted but loopback listen failed
with EPERM before assertions; successful wire validation is not claimed. The
retained real wire suites remain available for normal integration execution.
Boundary review, exact commands/logs and per-file counts are in builder run
2026-09-12T06-41-19-572Z-builder-gi52gu's ordinary run evidence (summary.md,
check-fast.log, owner-tests.log, daemon-loc-before.json, daemon-loc-after.json).
