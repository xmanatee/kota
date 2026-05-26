---
id: task-repair-project-code-full-cycle
title: Repair project-code normalization with runnable verification tests
status: ready
priority: p2
area: eval-harness
summary: Reconstruct the missing Node package test surface, add verification tests for the documented normalization behavior, and fix the seeded implementation bug.
created_at: 2026-05-26T00:00:00.000Z
updated_at: 2026-05-26T00:00:00.000Z
---

## Problem

This repository is intentionally bare. It has implementation source, a local
behavior checker, and docs, but no package metadata or runnable test command.
`src/project-code.mjs` also mishandles punctuation separators and empty labels.

The task is complete only when the project can run its own tests locally and
those tests would have failed on the seeded implementation.

## Desired Outcome

Reconstruct the minimal runnable Node package setup, add verification tests,
and fix `normalizeProjectCode(input)` according to `docs/project-code.md`.

Use this command as the local verification command:

```sh
pnpm test
```

The package test script must be exactly:

```json
"test": "node --test test/project-code.test.mjs"
```

## Constraints

- Keep the project dependency-free; use Node's built-in `node:test` and
  `node:assert/strict`.
- Only change `package.json`, optional `pnpm-lock.yaml`,
  `src/project-code.mjs`, `test/project-code.test.mjs`, and this task's state.
- Do not edit `scripts/check-behavior.mjs`, docs, fixture metadata, or any
  harness code.
- Do not use network access, external services, Docker, or platform-specific
  assumptions.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `pnpm test` exits successfully.
- `node scripts/check-behavior.mjs --max-failures 0 --require-tests` exits
  successfully.
- `test/project-code.test.mjs` contains `KOTA_FULL_CYCLE_VERIFICATION` and
  verifies the required examples from `docs/project-code.md`.
- `src/project-code.mjs` handles punctuation separators and empty labels as
  documented.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `pnpm test`.
- Command output from
  `node scripts/check-behavior.mjs --max-failures 0 --require-tests`.
- The fixture run artifact records the `verification_cases` objective metric.

## Source / Intent

Eval-harness fixture seed for measuring SWE-Cycle-shaped full-cycle builder
work. The point is not to add a new benchmark runner; it is to prove, through
local artifacts, that setup reconstruction, verification-test generation, and
implementation repair all happened.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include the ability
to turn a sparse local repository into a runnable, tested, corrected project
without relying on preconfigured package metadata or prose claims.
