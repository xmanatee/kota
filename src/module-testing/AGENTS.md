# Extension Testing

This directory contains the `ExtensionTestHarness` — a lightweight in-process harness for unit-testing `KotaExtension` definitions without a running daemon, real config, or network.

- Use the harness to test tool schemas, runners, route handlers, and event subscriptions in isolation.
- Keep the harness implementation self-contained in `index.ts`; tests belong alongside the harness code.
- The harness exposes `callTool`, `callRoute`, `emit`, and `teardown`. Add new harness capabilities here only when co-located extension tests repeatedly need the same setup pattern.
- Export only stable types and the `ExtensionTestHarness` class through `src/workflow-testing/testing-api.ts`; keep internal utilities unexported.
- Do not add production flags or hooks to extensions just to make harness testing easier. Design extensions with explicit inputs, outputs, and dependency injection so they are naturally testable.

## Key Modules

- `index.ts` — `ExtensionTestHarness` class: `create(extension, options?)`, `callTool(name, input)`, `callRoute(method, path, body?)`, `emit(event, payload)`, `getProvider(type)`, `teardown()`.
