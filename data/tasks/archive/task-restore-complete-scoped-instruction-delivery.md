---
status: done
---

# Restore complete delivery of the seven truncated instruction files

## Observed Failure

At published `538a5487fca0f0fb124179c269d27aa684128727`, the real
`findInstructionFiles` loader returns 8,016 characters ending in the truncation
marker for each file below. Every final rule is absent. The existing instruction
suite also fails these seven cases; this is observable lost guidance, not a
reason to delete the proof.

| AGENTS.md owner under src/ | Raw trimmed characters | Omitted characters |
| --- | ---: | ---: |
| core/agent-harness | 8,172 | 172 |
| core/modules | 8,742 | 742 |
| core/workflow | 9,487 | 1,487 |
| modules/autonomy | 9,168 | 1,168 |
| modules/eval-harness | 9,619 | 1,619 |
| modules/harness-parity | 8,541 | 541 |
| modules/telegram | 8,284 | 284 |

Missing tails include credential handling, confirmed process cleanup and honest
host/evaluation evidence rules. Eval/parity guidance was still below the cap at
its simplification commit `d63bb44a4`; subsequent growth caused the current loss.
The original audit run `2026-09-12T19-11-38-383Z-builder-7hd0ll` retains the
production probe and results as `instruction-probe.mjs` and `.json`.

## Scope And Outcome

Own `src/core/loop/instruction-files` and the seven named direct guidance
consumers. Deliver all necessary applicable guidance through the existing loader
and scoped documents. Concise guidance, existing reference expansion, or an
explicitly justified loader design may solve this; builders choose the design.
Preserve authority, safety, precedence and workflow-ownership rules.

Do not delete trailing rules, disable failing verification, raise a size cap
solely to make tests pass, add another instruction registry, or rewrite unrelated
runtime owners. This repair has no numerical deletion requirement.

## Acceptance

Exercise the production loader at the affected scope directories and show
complete delivery, including the previously missing tails. Verify reference and
precedence behavior and run applicable static checks. Byte counts alone do not
prove delivery. Keep any source scan only where it establishes a security
boundary unavailable through behavior. Record any test/support/production deltas
for the dependent aggregate audit without treating size as a deletion quota.

## Completion

Moved coherent guidance sections into adjacent documents expanded in their original
positions by the existing `@` reference mechanism. All original rules remain in
order, including the seven missing tails. The inherited Standards reference was
also oversized; its verification section now expands from `docs/VERIFICATION.md`.
The loader, physical-file cap, reference depth, and precedence are unchanged.

The instruction-owner guard now exercises production delivery, including referenced
leaves, instead of checking only AGENTS/CLAUDE byte sizes. It rejects truncation,
missing/circular references and unresolved depth-limited references. Six frozen
instruction captures under `.kota/runs/` remain historical evidence and are excluded
from maintained-guidance validation; all seven affected live scopes retain checks.

Run `2026-09-12T20-00-36-801Z-builder-e5lnx0` retains `instruction-originals.json`,
`instruction-probe.mjs` and `instruction-probe.json`. The originals match workspace
HEAD `ebd357d93229cb60e58e2d4d91d1454c25aa2252`. The production probe reproduces
truncation with the original files, then verifies every original nonblank line in
order, missing tails, full inherited Standards, and root-first precedence in all
seven repaired scope contexts. The instruction suite passes 200 tests, covering
reference expansion, depth, cycles, missing files, caps and scope precedence.

Aggregate-audit deltas: production TypeScript 0 lines; test TypeScript +14/-6
(net +8); guidance +367/-357 (net +10), including 355 lines moved verbatim into
eight referenced documents. No necessary rule text was deleted. Runtime evidence
and this terminal task record are outside those source/support counts.
