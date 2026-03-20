---
id: task-integration-test-autonomous-workflow-loop
title: Integration test the explorer → builder → improver workflow handoff
status: ready
priority: p2
area: testing
summary: Add an integration test that exercises the full autonomous loop — explorer run, builder pickup, improver feedback — against a minimal fixture repo, verifying state transitions and run artifacts.
created_at: 2026-03-19
updated_at: 2026-03-20
---

## Problem

The three autonomous workflows (explorer, builder, improver) were recently refactored into separate definitions. Each has unit-level validation but there is no integration test verifying that they hand off correctly — that explorer produces tasks builder can consume, and that improver receives the right run context after builder completes or fails.

A regression in the handoff (e.g., wrong trigger events, missing run state, bad step sequencing) would be invisible until a real run fails.

## Desired Outcome

An integration test (`.integration.test.ts`) that:
- Sets up a minimal fixture project with a seeded task in `ready/`
- Drives the builder workflow through at least one complete step sequence
- Asserts that run state and artifacts are written correctly under `.kota/runs/`
- Verifies the improver receives the expected trigger payload from a builder outcome

The test should be runnable in CI and complete in under 30 seconds using mocked or stubbed LLM calls.

## Constraints

- Do not make real LLM calls in tests — use stubs/adapters at the provider boundary (`vi.mock("../agent-sdk/index.js")` as used in `src/workflow/runtime.test.ts`)
- Use a temp directory for the fixture project; clean up after the test
- No production code changes purely to support testing (follow natural testability via adapter injection)

## Done When

- Integration test exists, passes, and runs in `npm test`
- Explorer → builder handoff is verified end-to-end
- Builder → improver trigger is verified
- CI does not time out on this test
