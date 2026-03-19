---
id: task-custom-tool-persistence-unit-tests
title: Add direct unit tests for custom-tool-persistence.ts
status: done
priority: p2
area: testing
summary: Add a dedicated test file for the custom-tool-persistence module, covering validateName, normalizeSchema, getToolPath, getToolsDir, and saveToDisk directly rather than only through integration.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/tools/custom-tool-persistence.ts` exposes several public functions (`validateName`, `normalizeSchema`, `getToolsDir`, `getToolPath`, `saveToDisk`) that are only exercised indirectly through `custom-tool.test.ts`. Direct edge-case coverage of validation logic and path helpers is missing.

## Desired Outcome

A `custom-tool-persistence.test.ts` file that exercises every exported function in isolation, covering boundary cases (name length limits, reserved names, regex edges, schema shape variants, disk I/O).

## Constraints

- No changes to production code.
- Tests must be self-contained and use a temp directory for I/O.

## Done When

- `npm test` passes with the new test file included.
- Every exported function in `custom-tool-persistence.ts` has dedicated tests.
