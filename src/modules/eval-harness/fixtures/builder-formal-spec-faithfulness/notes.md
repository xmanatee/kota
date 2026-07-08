# builder-formal-spec-faithfulness

## Source

No source run id. This is a smoke fixture prompted by the
specification-faithfulness failure shape where a machine-checkable contract can
be internally executable but still fail to encode the user's informal
requirement.

## Why this fixture exists

KOTA already has fixtures for verifier calibration, accepted alternatives,
source-grounded synthesis, protocol-conditioned implementation, and
eval-authoring restraint. This fixture isolates a narrower risk: the builder is
asked to author the executable spec itself. The scorer then treats the authored
spec as the thing under test, rather than trusting that an executable artifact
is faithful because it runs.

## What the fixture grades

The initial project contains `REQUIREMENTS.md`, official examples,
adversarial cases, a deliberately weak `src/spec-contract.mjs`, and a local
checker. The builder must implement `validateReturnLabelDecision(request,
decision)` and write `spec-faithfulness-result.json`. The checker requires the
contract to accept official valid decisions, accept valid alternative output
shapes, reject invalid approvals, reject omitted input assumptions, and keep
the fixture-owned source packet and verifier unchanged.

`node scripts/check-spec-faithfulness.mjs --self-test-shortcuts` exercises the
shortcut candidates called out by the task: accept-all specs, single-reference
specs, omitted-assumption specs, reject-valid specs, hidden-case hardcoding,
source-packet edits, verifier edits, and prose-only artifacts. The fixture also
declares one accepted-alternative calibration case with a different faithful
predicate-table implementation.

The objective metric `adversarial_rejections` reports how many visible
adversarial invalid approvals the authored contract rejects. Pass/fail remains
predicate-based.
