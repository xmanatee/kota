---
id: task-add-google-workspace-module-tests
title: Add test coverage for the google-workspace module
status: done
priority: p2
area: testing
summary: The google-workspace module has five source files (auth, gmail, calendar, drive, index) with real OAuth logic and zero tests.
created_at: 2026-04-11T17:03:00Z
updated_at: 2026-04-11T20:18:00Z
---

## Problem

The google-workspace module contains non-trivial OAuth token refresh logic,
three service-specific tool implementations (Gmail, Calendar, Drive), and
approval-gated write operations. None of this has test coverage. A regression
in the auth flow or tool schema would go undetected until runtime.

## Desired Outcome

Unit tests covering:

- OAuth credential loading and token refresh edge cases (expired, missing, malformed).
- Tool schema correctness for each service (gmail, calendar, drive).
- Approval-gated tools are correctly marked dangerous.
- Module registration contributes the expected tool set.

## Constraints

- Do not call live Google APIs. Mock HTTP responses at the boundary.
- Follow existing module test patterns in the codebase.
- Keep tests co-located under `src/modules/google-workspace/`.

## Done When

- Each source file in the module has at least one corresponding test file.
- Auth refresh happy path and common failure modes are covered.
- Tests pass in CI.
