---
status: dropped
---

# Automated standards checking (biome, linters)

## Problem

Biome was configured but not in the automated verification pipeline,
allowing lint errors to accumulate undetected across builder runs.

## Desired Outcome

Linting enforced automatically on every builder run, keeping the codebase
clean without manual intervention.

## Constraints

- Must integrate with the existing verification pipeline.
- Should not slow down the feedback loop significantly.

## Done When

- Biome lint runs as part of the automated verification steps.
- Existing lint issues are resolved.

## Why Dropped

Addressed in the improver run on 2026-03-19: `verify-lint` was added to
`createVerificationAndRestartSteps` and all existing lint issues were fixed.
Biome is now a required verification step alongside typecheck, tests, and build.
