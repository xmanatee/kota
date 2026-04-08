---
id: task-extension-integration-test-harness
title: Add extension integration test harness so extensions can be tested as loaded units without a daemon
status: done
priority: p2
area: architecture
summary: Extensions currently have unit tests for individual functions but no standard way to exercise them as fully loaded KotaExtension units (with onLoad, tools, routes, CLI commands). A lightweight ExtensionTestHarness would close this gap and follow the pattern already established by WorkflowTestHarness.
created_at: 2026-04-08T21:43:21Z
updated_at: 2026-04-08T21:43:21Z
---

## Problem

`WorkflowTestHarness` (`src/workflow-testing/`) lets workflow authors test full
workflow definitions in-process without spinning up a daemon. No equivalent exists
for extension authors.

Today, extension tests (e.g. `telegram/telegram.test.ts`, `github/github.test.ts`)
test internal helpers directly rather than the extension's `KotaExtension` contract.
This means:

- `onLoad` / `onUnload` lifecycle paths go untested.
- Route contributions are never exercised in tests.
- Tool registrations are verified only by calling the runner function directly, bypassing
  the loader's risk/group registration path.
- The extension contract can drift silently — a test can pass while the extension fails
  to load in production.

## Desired Outcome

A `ExtensionTestHarness` class exported from `kota/testing` (alongside `WorkflowTestHarness`)
that:

- Accepts one or more `KotaExtension` definitions.
- Calls `onLoad` with a mock `ExtensionContext` that captures registered tools, skills,
  dynamic state providers, event subscriptions, and routes.
- Exposes helpers:
  - `getTool(name)` — returns the tool definition and runner for assertion.
  - `callTool(name, input)` — invokes the tool runner and returns the result.
  - `getRoutes()` — returns HTTP routes contributed by the extension.
  - `getDynamicState()` — calls all registered dynamic state providers and returns output.
  - `emitEvent(eventName, payload)` — fires a bus event and captures handler results.
- Calls `onUnload` in `teardown()` and verifies clean unload.
- Works in Node test environments without a real daemon, real filesystem, or network.

## Constraints

- The harness must not require a running daemon, real config file, or real provider
  implementations — inject stubs for `MemoryProvider`, `TaskProvider`, etc.
- Mirror the design of `WorkflowTestHarness` for consistency; reuse its interface
  patterns where applicable.
- Export via `kota/testing` sub-path (existing entry point in `workflow-testing/testing-api.ts`).
- Do not modify the `KotaExtension` interface or `ExtensionContext` production types.
- Keep the harness in `src/workflow-testing/` or a sibling `src/extension-testing/` directory.

## Done When

- `ExtensionTestHarness` is exported from `kota/testing`.
- At least one existing extension (e.g. `memory` or `history`) has a lifecycle integration
  test using the harness that covers: load, tool call, dynamic state, and unload.
- The harness is documented in `docs/EXTENSIONS.md` (or a new `docs/TESTING.md`) with a
  usage example.
- Existing extension unit tests are unaffected.
