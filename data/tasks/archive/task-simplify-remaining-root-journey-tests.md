---
status: done
---

# Remove root journey duplication after owner-level consolidation

## Scope And Evidence

Own direct `src/*.test.ts` and `src/*.integration.test.ts` journeys and root
test support, not nested owner suites. The retained inventory has 16,286 LOC
across 67 root files; start with `scope-onboarding-e2e.integration.test.ts`
(1,394) and `workflow-step-executor-agent.integration.test.ts` (1,110).
Reuse completed root-cleanup evidence rather than repeating its entire
support/export inventory.

## Required Outcome

After predecessors integrate, trace each retained root journey to the additional
packaging, process, cross-module, policy or operator failure it uniquely catches.
Delete owner-case repetitions; keep concise end-to-end wiring proof. Collapse
source/built variants only where they prove the same thing, preserving actual
installed-package/public-API tests for packaging differences.

Remove abandoned helpers with their final consumer. A setup wrapper may compose
real owners, but must not interpret workflow execution or fabricate terminal
results. Keep temporary files attributable and do not move tests into uncounted
scripts. Do not broadly rerun all portfolios after each file deletion.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. Publish reduced real
journeys, representative boundary checks, support cleanup and local numbers.
The dependent final audit owns aggregate counting and broad/release execution,
not this cleanup task.


## Completion

Removed redundant root JSON/preflight/metadata cases, a non-executing recovery
case, a manually wired prompt-expansion suite, a third hook-payload rerun, and
onboarding source-file catalogs. Retained SDK correction/model propagation,
passive restrictions, real mutation rollback, CLI onboarding/restart/isolation,
and installed-package/public-API coverage. Hook and REPL fixtures now keep
session state in disposable scopes. Inline orphan helpers retired with their
consumers; production and nested owner suites are unchanged.

Frozen-recipe direct root test counts: 19,356 → 18,524 LOC (-832), 79 → 78 files.
Recipe-classified support remains 203 LOC; all ten root support/fixture files
remain 1,677 LOC including spellings the recipe does not classify. Production
and exclusion deltas are zero. The historical 67-file estimate predates this
checkout. These are local candidate counts, not aggregate publication proof.

Validation: 18 retained root tests and 48 workflow/harness owner tests pass.
The unchanged onboarding baseline reproduces the candidate's delegated-work
stall and coordinator disposal timeout; full publication/restart success is not
claimed. Thirteen unchanged prompt-input owner cases encounter sandbox EPERM
on cleanup; real REPL expansion passes. The ordinary run summary records the
retained boundary families, removed/reused owners, counts, logs and final static
gate. Broad/release and live validation remain with the dependent final audit.
