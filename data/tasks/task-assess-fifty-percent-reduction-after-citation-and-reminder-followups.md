---
status: open
priority: p2
depends_on: [task-restore-citation-restart-proof-after-evidence-retention, task-restore-tool-authorization-consumer-proofs, task-reconcile-runtime-issue-observation-verification, task-consolidate-reminder-transition-verification, task-share-answer-command-outcomes-across-channels, task-render-workflow-details-without-synthetic-runtime-metadata, task-retire-historical-runtime-copies-from-source-tree]
---

# Assess delivered simplification and preserve remaining cleanup work

## Goal

Keep necessary behavior while removing genuinely redundant verification and
needless supporting mechanisms. The owner's minimum is 50% executable-test
reduction, with 70% as a stretch. Neither percentage is a license to delete
useful protections or a per-child quota.

Baseline `fcaf40c60921445b1bfc7cb9ebac91013ce7f77a` has 334,805 executable-test
LOC. Use the frozen `scripts/count-verification-loc.py` recipe; the ceiling is
167,402. Report support, exclusions and production separately. Latest retained
audit `2026-09-12T22-32-50-597Z-builder-67j7si` recorded 266,089: target not met.
The original four proof repairs do not close that gap. The answer-command and
workflow-detail predecessors remove demonstrated production duplication; the
runtime-copy predecessor removes repository clutter without deleting evidence.
These are independent implementation tasks, not a claim that cleanup is finished.

The September 13 review at `ab2889452` counted 266,114 executable-test lines.
Twelve recent cleanup implementation commits removed a net 6,221 test lines but
added a net two production lines. That is real test reduction, not substantial
production simplification. Assess both dimensions and preserved capability.

Retain recipe SHA256
`08d6b17c1f8e68d6b3bc77e05405d0a48c05c9b6750956776dcad89e536a505b`.
The retained audit discloses missing integration support suffixes; reproduce
original and corrected support classifications consistently on baseline and
final. Baseline support/exclusions are 26,305/20,872; the pinned audit reports
21,075/15,791. Corrected support is 27,917 -> 22,826, with test LOC unchanged.
The detailed correction and per-file blob evidence stay in the retained audit.

## Bounded Assessment

After predecessors integrate, measure canonical once and review their outcomes.
Use existing verification and focused checks where changed behavior warrants
them. Do not repeat full portfolios to rediscover known unrelated failures.
Missing optional external benchmarks do not block this assessment.

If the goal is met, record it honestly. Otherwise identify concrete, useful
owner-sized simplifications or a specific conflict with preserving necessary
behavior. Publish independent follow-ups using existing task/decomposition
mechanisms and retire this assessment as superseded, not as goal achievement.
Do not implement the remainder of the repository in this task, reissue unchanged
audits, or block independent cleanup waiting for an aggregate numeric outcome.
Do not replace this with another percentage-only assessment. Any remaining
follow-up must own a concrete implementation outcome and name the duplicated
behavior or unnecessary mechanism it removes. Supersession preserves the unmet
owner goal; it never establishes completion. Necessary safety/behavior checks
take precedence over the numeric target, with any genuine conflict reported.

## Shared Verification Rules

Test public behavior at its narrowest sufficient owner. Keep composed tests only
for failures the owner checks cannot establish. Consolidate duplicated setup and
mechanisms when it actually simplifies maintained consumers; modest local fixture
duplication can be clearer than a universal test interpreter. Do not move tests
into support, minify, disable coverage or remove product behavior to improve LOC.
Give representative before/after observations, not a per-assertion evidence registry.

## Acceptance

One attributable aggregate result and a concrete disposition are published.
Unmet targets remain explicit; remaining actionable work reaches canonical task
files with sensible dependencies instead of being stranded in an audit artifact.
