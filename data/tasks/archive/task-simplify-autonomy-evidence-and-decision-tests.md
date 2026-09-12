---
status: done
---

# Simplify shared autonomy evidence and decision verification

## Scope

Own autonomy tests outside `src/modules/autonomy/workflows/`: 14,747 LOC across
72 files in the retained inventory. Inspect evidence projection, critic parsing,
queue assessment, continuation policy and task-generation decision owners.
Workflow consumers belong to a dependent task, not this one.

## Required Outcome

Use small representative evidence sets to prove meaningful decisions: fresh versus
repeated evidence, actual unresolved failure, priority, truthful no-action outcomes
and attributable task proposals. Replace copied artifact catalogs, entire run
directories and repeated ownership matrices with the existing typed evidence owner.
Do not weaken malformed-evidence rejection or turn untrusted text into authority.

Test policy judgments through decisions and effects, not exact prompt wording,
private helper calls or every field in duplicated fixtures. Preserve explicit
distinctions among unknown, failed and successful evidence. Do not retune product
cadence, implement the separate continuation-calibration task, or add registries.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. A concise family-level
retained/deleted rationale, focused decision tests, support cleanup and measured
local delta complete this slice. It does not own all automation behavior or the
final percentage.

## Completion

Consolidated critic parsing/publication, issue projection, generated-work lifecycle
and report evidence tests. Reused the canonical typed writer-integration fixture;
removed the external-pattern catalog's test-only validator, duplicated report
cohorts and unused proposal-template content. Retained malformed-evidence and
scope-confinement rejection, priority/retained-owner behavior, deferred effects and
truthful attribution. No production, workflow, prompt or cadence change.

Local frozen-recipe counts: executable tests 14,719 → 14,339 LOC (380 removed),
authored support 2,266 → 2,234 LOC (32 removed); exclusions unchanged. These are
candidate-slice counts, not global published acceptance. Family rationale and
per-file counts are in this builder run's `agent/summary.md` and
`agent/autonomy-{before,after}.json`.

Validation: 14 unique focused owner suites / 65 distinct tests passed across two
selections; `pnpm check:fast` passed, with test typechecking and focused lint rerun
after final test edits. Final task validation checks the archive transition.
Full release verification and global percentage remain with the final audit.
