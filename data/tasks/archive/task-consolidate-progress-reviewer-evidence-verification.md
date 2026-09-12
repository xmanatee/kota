---
status: done
---

# Consolidate progress-reviewer evidence collection and packet verification

## Evidence And Scope

At published `538a5487fca0f0fb124179c269d27aa684128727`,
`src/modules/autonomy/workflows/progress-reviewer` has 4,073 test LOC across
12 files; `workflow.test.ts` accounts for 2,078. Direct collection, artifact
citation, compact packet priority and hidden-citation normalization cases coexist
with the retained bounded-packet workflow journey.

Completed autonomy evidence/consumer children improved handoffs and publication;
this task owns the remaining collector/packet overlap decision within this
subtree and its direct helpers. It does not assume those cases are redundant.

## Outcome

Give collection/projection and workflow transport their narrowest sufficient
proofs. Keep the composed journey for additional transport/correction failures.
Consolidate demonstrated repeated fixture construction and assertions while
preserving scope isolation, malformed/quarantined metadata, digest integrity,
pending-publication attribution, bounded traversal and valid citations.

Do not rewrite reviewer prompts, citation policy, runtime persistence or issue
ownership to obtain deletions. Do not reopen unrelated autonomy workflows.

## Acceptance

Show family-level admission reasoning and measured category deltas. A no-change
result must explain the distinct remaining failures. Run selected collector,
packet and citation tests plus the retained real workflow handoff. Preserve
negative scope, malformed evidence, digest and citation observations; runtime
state and transport semantics must come from their production owners.

## Verification And Limits

Follow the measurement and shared rules in
`task-reassess-published-fifty-percent-test-reduction`. The 50% minimum belongs
to the aggregate, not this slice. Preserve necessary behavior and readable tests;
a demonstrated no-change decision is valid. No displacement into helpers,
snapshots, fixtures, generated outputs, renamed or disabled tests. Report test,
support, exclusion and production deltas separately. Use family-level admission
reasoning and representative retained/deleted examples, not per-assertion records
or a new scenario interpreter. Reuse valid prior proof and report limitations.

## Completion

Consolidated artifact collection/priority fixtures and dead-letter
collection/task-citation/compaction fixtures in `workflow.test.ts`. Reused the
existing historical-run fixture for unsafe and mismatched metadata identities.
The selected-scope negative case now registers both scopes. Independent traversal,
quarantine, pending-publication, digest, citation and real workflow transport /
correction observations remain. No production behavior or shared support changed.

Artifact collection and projection now share one real tree; nested refs and
priority under noise remain asserted. Dead-letter observations share six real
persisted queue items, retaining truncation and task/item citation checks. The
standalone circular-serialization assertion is covered by the real workflow's
serialized evidence handoff. Repeated known-ID acceptance checks were removed
from run/approval collection; collector refs and the kind-independent citation
decoder retain their own oracles. Distinct direct normalization paths, malformed
runtime authority and workflow correction/restart checks were retained because
the bounded transport journey does not establish those decisions.

Measured against candidate base `e9739c6fe54ae67356fd7a99d4da99ae2f03297a` with
the frozen recipe's classification and physical-line counting:

| Scoped category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Executable test LOC | 4,073 | 3,891 | -182 |
| Authored support LOC | 589 | 589 | 0 |
| Generated/vendor exclusion LOC | 0 | 0 | 0 |
| Production source LOC | 5,245 | 5,245 | 0 |

All 12 files remain; cases decrease from 82 to 79. `workflow.test.ts` decreases
from 2,078 to 1,896 lines. The corrected support-suffix rule yields identical
local numbers. This is a candidate slice measurement, not the published aggregate
or fulfillment of the parent assessment's 50% floor.

Validation: baseline 82/82 and final 79/79 progress-reviewer tests passed,
including collector, packet, citation, integrity and real workflow handoff /
correction cases. `pnpm check:fast`, final edited-file Biome and whitespace
checks passed. Temporary fault probes independently failed on lost artifact
priority and leaked raw dead-letter IDs; both mutations were restored before
the final passing suite. No release build, full repository suite, native-client
build or live evaluation was needed for this test-only slice; aggregate release
assessment remains with the parent task.

Run `2026-09-12T20-00-32-529Z-builder-01kfsu` retains family admission reasoning
in `summary.md`, category counts in `measurement.json`, the final test output
in `verification.log` and the two intentional fault-probe logs.
