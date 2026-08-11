---
id: task-replace-configuration-value-tests-with-behavioral
title: Replace configuration-value tests with behavioral coverage
status: done
priority: p1
area: architecture
task_class: Meta
summary: Remove tests that merely freeze declarative configuration values and establish project guidance and review checks that require tests to cover mechanisms and behavior.
created_at: 2026-08-07T01:04:49.507Z
updated_at: 2026-08-11T05:39:15.059Z
---

## Problem

Some tests assert literal shipped preset values or repeat declarative
configuration objects. Those tests fail whenever an operator intentionally
changes a model name, while providing no evidence that configuration is
validated, resolved, propagated, rejected, or honored at runtime. They confuse
configuration inspection with behavioral verification and encourage duplicated
sources of truth.

This was exposed when changing the AGY model mapping: literal tier assertions
had to be edited even though the underlying preset-resolution behavior was
unchanged.

## Desired Outcome

Establish and apply a clear repository testing rule:

- declarative values are inspected in their canonical JSON/registry source;
- schemas and validators test valid/invalid shapes and boundary failures;
- resolution tests cover precedence, propagation, and no-fallback behavior;
- integration tests prove the selected configuration reaches the runtime and
  changes observable behavior;
- tests do not duplicate literal configuration catalogs merely to freeze them.

Audit configuration-related tests, remove literal-value snapshots that add no
behavioral protection, and replace them only where a mechanism or behavior is
currently untested. Update the applicable `AGENTS.md` and engineering standards
so builders and reviewers apply the distinction consistently.

## Constraints

- Do not delete parser, schema, validation, precedence, fallback, propagation,
  or runtime behavior coverage.
- Do not replace literal unit assertions with equivalent snapshots or copied
  fixtures.
- Keep each declarative value in one canonical source. Generated projections
  may be compared to that source, not to another handwritten copy.
- Configuration correctness checks belong in validators, doctor output, or
  direct structured inspection when no behavior is involved.
- Keep the guidance concise and distinguish configuration data from logic that
  consumes configuration.

## Done When

- The relevant root/model/config testing guidance explicitly requires tests to
  cover mechanisms and behavior rather than literal configuration values.
- An audit identifies every test that merely repeats model/preset/config data
  and records keep/remove/replace rationale.
- Redundant literal assertions and snapshots are removed.
- Remaining tests cover validation, precedence, propagation, runtime selection,
  rejection, or observable effects and name that behavior clearly.
- A simple source search and focused test run demonstrate that one intentional
  config value change no longer requires unrelated test-data edits.

## Source / Intent

Owner direction on 2026-08-07: configuration values should be checked directly
in JSON or their canonical registry; tests must cover logic, mechanisms, and
behavior instead of freezing configuration literals. Repository guidelines
must state this explicitly.

## Initiative

Behavior-focused verification and single-source configuration.

## Product / Safety Link

This closes false-confidence risk in the AGY rollout tasks
`task-validate-agy-model-routing-against-long-horizon-co` and
`task-prove-agy-builder-parity-end-to-end`: model strings appearing in source
must not substitute for evidence that the selected runtime behaves correctly.

## Acceptance Evidence

- A checked-in audit artifact listing removed, retained, and behavior-replaced
  configuration tests with rationale.
- Updated scoped guidance plus focused test transcripts showing configuration
  validation/resolution/runtime behavior remains covered without copied model
  catalogs.
