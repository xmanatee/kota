---
status: open
priority: p1
---
# Restore dispatcher routing when retained security evidence fails validation

## Problem



## Desired Outcome

Ordinary eligible work can dispatch when a retained security finding fails validation. The security-review state owner preserves the invalid entry and its provenance with an inspectable recovery disposition, prevents invalid findings from authorizing publication, and supports safe reconciliation through existing runtime ownership. Diagnose the persistence or compatibility boundary responsible and prevent recurrence without silently discarding evidence, inventing invariant identity, or weakening finding validation. Coordinate with the existing security-family task without duplicating its publication and cohort work.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

Exercise the production persisted-state and runtime.idle boundaries with the cited pending finding validation failure. Show eligible task routing continues, invalid evidence remains visible and cannot publish, and valid security evidence retains its normal behavior. Verify the disposition survives restart and owner-mediated reconciliation preserves provenance and task ownership. Include an attributable scoped dispatcher export demonstrating recovery from this failure; distinguish representative reproduction from recovery of the actual retained entry.

## Context

Issue reviewer disposition:     The scoped issue-evidence.json records three distinct dispatcher failures between 07:53 and 08:44 UTC; two run records repeat the dead-letter observations. All reject pending[2].finding.violatedInvariant against the lowercase token pattern. Dispatcher decodes the entire security-review state before routing, so this retained entry prevents ordinary dispatch. Current review-state.ts reproduces that failure path; the export does not establish how the invalid value entered persistence. task-review-security-by-evidence-and-root-cause-family owns valid pending-evidence publication and live-cohort acceptance, but does not cover this state-decoding failure that blocks all routing. No active task explicitly owns it. This requires builder-owned source repair, not doctor.fix.

Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-00fd9288-826d-441f-84b2-05dec8fdb6f9
- dead-letter: .kota/dead-letter-queue/items.json#dlq-36536ce4-c6d9-4ead-af27-46a5ac49ddc6
- dead-letter: .kota/dead-letter-queue/items.json#dlq-a3adccf0-be89-4fe8-bda4-e33179b1fc1e
- run: .kota/runs/2026-09-11T07-53-45-796Z-dispatcher-8240rg/metadata.json
- run: .kota/runs/2026-09-11T08-14-13-780Z-dispatcher-tl4eej/metadata.json
