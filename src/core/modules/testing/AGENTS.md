# Module Testing

This directory contains the `ModuleTestHarness` — a lightweight in-process harness for unit-testing `KotaModule` definitions without a running daemon, real config, or network.

- Use the harness to test tool schemas, runners, route handlers, and event subscriptions in isolation.
- Keep the harness implementation self-contained in `index.ts`; tests belong alongside the harness code.
- The harness exposes `callTool`, `callRoute`, `emit`, and `teardown`. Add new harness capabilities here only when co-located module tests repeatedly need the same setup pattern.
- Export only stable types and the `ModuleTestHarness` class through `src/core/workflow/testing/testing-api.ts`; keep internal utilities unexported.
- Do not add production flags or hooks to modules just to make harness testing easier. Design modules with explicit inputs, outputs, and dependency injection so they are naturally testable.

