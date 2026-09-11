---
status: open
priority: p1
depends_on: [task-prove-seventy-percent-test-loc-reduction]
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
