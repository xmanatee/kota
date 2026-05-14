# Test Infrastructure

This directory holds Vitest-only setup and helpers that are not part of the
runtime package.

- Keep helpers focused on test execution infrastructure.
- Do not put production fixtures, runtime state, or project data here.
- Prefer in-process harnesses over real network listeners when a test only
  needs to exercise HTTP routing logic.
