---
status: open
priority: p1
depends_on: [task-simplify-remaining-root-journey-tests, task-simplify-evaluation-and-parity-tests, task-simplify-approval-boundary-tests, task-simplify-tool-execution-owner-tests]
---

# Verify a fifty-percent reduction with a lean behavioral test portfolio

## Owner Decision And Measurement

The September 11 owner decision replaces the mandatory 70% target with a minimum
50% reduction; pursue 70% where justified by real duplication and stronger owners.
Neither number is an industry standard or a permanent runtime/commit gate.
Never remove necessary behavior, safety checks or product functionality to hit it.

Retain baseline commit `fcaf40c60921445b1bfc7cb9ebac91013ce7f77a`, executable-test
LOC 334,805, authored support 26,305 and generated/vendor exclusions 20,872.
Use the frozen `scripts/count-verification-loc.py` recipe (SHA256
`08d6b17c1f8e68d6b3bc77e05405d0a48c05c9b6750956776dcad89e536a505b`). At least
50% means no more than 167,402 executable-test LOC; 70% means at most 100,441.
Count the published canonical tree, not an unmerged candidate. Report support,
exclusions, and changed production separately. Do not hide code in renamed files,
helpers, snapshots, eval fixtures, generated outputs, minification or disabled tests.
If the old recipe has a real classification defect, disclose it and reproduce
both baseline and final with the same corrected rule as well as the original.

## Shared Rules For The Child Tasks

- Read current standards and use existing inventories and completed children as
  evidence, not proof that all remaining tests are useful or redundant. Test an
  observable consumer contract at its narrowest sufficient owner. Keep composition
  tests for wiring/process/protocol failures owner tests cannot establish. Types
  and schemas do not prove runtime durability or effects.
- Apply the six admission questions at behavior-family level. A short explanation
  and representative retained/deleted examples suffice; do not generate six-field
  records for every assertion, blanket counterfactual matrices or another registry.
  Existing guidance may already supply the answer. Preserve readable tests; modest
  fixture duplication is preferable to a universal scenario interpreter.
- Give each builder only its named owner and direct consumers. Local completion
  requires a reviewed simplification and evidence, not 50% deletion in that slice.
  A demonstrated no-change decision is valid. Investigate high-value overlap first;
  do not manufacture deletions or expand into unrelated modules to look busy.
- Run focused checks after coherent changes and composition checks when the changed
  boundary requires them. Run broad checks at integration/final assessment, not
  after every small edit. Sample meaningful fault observations where needed to
  prove high-risk coverage; no extra test just to record a configuration value.
- Keep local before/after numbers and removed/reused owners in ordinary run evidence
  and task completion. Retire temporary helpers with their final consumer. Update
  misleading scoped instructions on the touched path instead of adding appendices.
  A dependency permits shared-contract consumption, not parallel editing of its owner.

## Evidence And Feasibility

The retained postcheck-22 census has 265,690 test LOC (20.64% reduction), leaving
98,288 LOC above the new floor. This is an opportunity estimate, not proof those
lines can safely disappear. The completed predecessor checkout had 288,864 LOC;
26 tasks marked done did not establish aggregate acceptance. Large current families
include workflow 29,728, daemon 20,797, autonomy 33,835, root journeys 16,286,
tools 12,231, workflow-ops 11,443, eval 10,538 and approval queue 8,115.
Child boundaries target these owners and direct consumers, not arbitrary file size.
Counts of mocks, casts or source reads are investigation leads, never deletion rules.

## Final Assessment, Not Another Giant Builder

After children integrate, recompute the aggregate and reconcile their bounded
evidence. Sample affected security, recovery, external-effect and operator journeys;
run the applicable broad/release portfolio once against the final revision. Reuse
unchanged valid proofs and report actual environment limitations.

If the floor or a distinct behavior proof remains unmet, identify concrete remaining
owner-sized work. Use existing decomposition to replace this audit with bounded
follow-ups and a dependent successor audit carrying the same 50% floor. Retire this
audit only as superseded, never as successful delivery. Do not implement the remaining
repository in its repair loop, call workload an external blocker, or reduce the
floor without an owner decision. If evidence shows the floor conflicts with retaining
necessary behavior, surface that specific decision rather than deleting the behavior.

## Done When

Published test LOC is at most 167,402; changed families retain distinct behavioral
protections; no disguised displacement or known change-induced regression remains;
and final verification is attributable. Explain unpursued stretch work. Do not
require a new exhaustive audit of untouched tests or proof that no duplicate exists
anywhere. The dropped strategic anchor stays dropped, with no checkbox ritual.

## Research Basis

- [Google: change-detector tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html): assertions that merely mirror implementation can add maintenance without detecting behavioral defects.
- [Software Engineering at Google: effective unit tests](https://abseil.io/resources/swe-book/html/ch12.html): prefer observable behavior, clarity and tests resilient to internal refactoring.
- [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html): avoid repeating owner-level conditions at every integration layer; retain higher layers for additional confidence, and avoid over-abstracting test code.
