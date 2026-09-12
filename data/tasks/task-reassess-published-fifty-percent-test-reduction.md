---
status: open
priority: p1
depends_on: [task-consolidate-workflow-retry-replay-route-verification, task-consolidate-progress-reviewer-evidence-verification, task-restore-complete-scoped-instruction-delivery]
---

# Reassess the published fifty-percent test reduction after bounded follow-ups

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

Supersedes the unsuccessful assessment in archived
`task-verify-fifty-percent-test-reduction`. Published revision
`538a5487fca0f0fb124179c269d27aa684128727` has 265,970 executable-test LOC:
20.5597% reduction and 98,568 above the unchanged 167,402 ceiling. The four
original direct children integrated only 2,252 net test LOC of reduction.
Neither completed task counts nor summed local deltas establish acceptance.

Original support is 26,305 -> 21,075; exclusions 20,872 -> 15,791.
The frozen recipe misses `-fixture.integration.ts` and
`-test-tools.integration.ts` support suffixes. Adding those plus the equivalent
plural `-fixtures.integration.ts` on both baseline and final gives support
27,917 -> 22,826; executable tests and exclusions are unchanged. Preserve both
original and corrected measurements and disclose the classification limitation.
The original audit's run evidence contains both recipes, per-file Git blob IDs
and complete reports; the frozen repository recipe must remain intact.

Other `.ts/.tsx/.js/.mjs/.swift` sources under src/ and clients/ grew
340,567 -> 352,301 under the original classification, or 338,955 -> 350,550
with the support correction. These include unrelated product work, not only
cleanup. Later publication `19cd328b6` adds 41 test LOC and one net production
LOC; the prior validation stays attributed to its pinned revision.

The predecessors name bounded route, reviewer-evidence and instruction-delivery
outcomes. Their small candidate surfaces are not a claim that 98,568 LOC can
safely disappear. Do not repeatedly reissue unchanged cleanup tasks as if their
combined sizes established feasibility. If those owners find no justified
simplification, preserve that evidence and identify a different concrete owner
opportunity or a specific evidence-backed owner decision; do not lower the floor.

Prior proof: full static gate and production build passed, along with 150
selected authorization, SQLite/Git recovery, execution, evaluator/parity and root
journey checks. The broad attempt remained incomplete after repeated process/HTTP
stalls; 73 printed failed files / 449 failures are partial observations, not a
complete suite total. Seven instruction truncations were separately reproduced.
Other untriaged failures must not all be labeled environmental. The next audit
must triage remaining failures and obtain proportionate final proof, not inherit
an overall pass. No live-model or full native-process/HTTP success was established.

Use a nested temporary directory in the current authorized tool-runtime root
when fixture stores require a readable grandparent; do not reuse an old run's
path. Never broaden candidate host authority to overcome sandbox restrictions.
Unrelated retained benchmark writers keep their contracts and resource lineage;
this audit adds no dependency on their live model work.

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
A replacement proposal in run artifacts alone does not retire the audit: concrete
replacement task contracts, dependencies and the superseded transition must be
reviewable together before runtime-owned publication.

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
