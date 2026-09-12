---
status: open
priority: p1
---

# Consolidate tool-execution verification at execution and policy boundaries

## Scope

Own `src/core/tools` (12,231 test LOC) and `src/modules/execution` (5,039), with
their directly used test support. Identify generic runner/policy behavior versus
tool-specific semantics; native harness adaptation belongs to its separate task.

## Required Outcome

Remove repeated setup and policy permutations in tool consumers when an existing
runner or execution boundary already proves them. Preserve distinct validation,
denial, cancellation, subprocess termination, path confinement and effect handling.
Use shared typed parameter/permission consumers rather than literal tool catalogs.

Mocks of process creation are useful for argument/error projection but do not
replace real process-group or filesystem safety checks. Keep those proofs at
their owner, not once per tool. Do not rewrite execution protocols or grant broader
host access to make a test pass. Security primitives are not redundant merely
because TypeScript interfaces share a shape.

## Acceptance

Use `task-verify-fifty-percent-test-reduction` rules. Publish local ownership
simplifications and remove obsolete support with its last consumer. Run relevant
behavioral and real-boundary checks once; report test/support and any implicated
production deltas.
