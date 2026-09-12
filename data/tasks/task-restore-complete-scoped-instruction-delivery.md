---
status: open
priority: p1
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
