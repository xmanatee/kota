---
id: task-automated-standards-checking
title: Automated standards checking (biome, linters)
status: dropped
priority: p2
area: toolchain
summary: Add strict linters and biome to the validation pipeline so code quality is checked automatically.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Biome was configured but not in the automated verification pipeline,
allowing lint errors to accumulate undetected across builder runs.

## Why Dropped

Addressed in the improver run on 2026-03-19: `verify-lint` was added to
`createVerificationAndRestartSteps` and all existing lint issues were fixed.
Biome is now a required verification step alongside typecheck, tests, and build.
