---
status: done
---

# Enforce AGY model readiness gates and dynamic preset resolution validation

## Problem

    If a selected AGY model is unavailable, autonomy loops could execute with unexpected defaults; additionally, preset tests asserting hardcoded model literals break during model updates.

## Desired Outcome

    Update doctor readiness checks to reject unavailable models/efforts before autonomy dispatch, and refine preset tests to validate selection and propagation contracts without literal model string expectations.

## Constraints

- Fail doctor/readiness visibly when the selected model or effort is unavailable; do not fall back silently.
- Do not introduce a second model routing registry or hardcoded per-workflow model strings.
- Preserve existing preset priority resolution rules (flag > env > config > default).

## Done When

- Doctor readiness check validates candidate model/effort availability against active AGY harness status.
- Preset resolution tests in preset.test.ts and preset-parity.integration.test.ts pass using dynamic contract assertions.
- Integration tests confirm autonomy pre-flight rejection when an invalid or unavailable model is specified.

## Source / Intent

    Ensure model selection and readiness enforcement prevent silent fallbacks and maintain un-brittle test suites.

Decomposed from `task-validate-agy-model-routing-against-long-horizon-co` after builder run `2026-08-07T01-57-52-891Z-builder-epufuo` exhausted repair.

## Initiative

    Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- Doctor readiness test suite passing with model availability validation.
- Preset resolution test suite passing without hardcoded model string assertions.
