# Workflow Testing

This directory contains the `WorkflowTestHarness` — an in-process harness for unit-testing workflow definitions without a running daemon or real agent.

- Use the harness to test `when` predicates, step skip/run logic, branch conditions, and foreach iteration in isolation.
- Keep the harness implementation in `index.ts` and the public API surface in `testing-api.ts`. Tests belong here alongside the harness code.
- Agent steps require a `stepMocks` entry; missing mocks throw a descriptive error. Code steps run for real.
- When adding a new step type to the workflow runtime, add matching harness support here and cover it with a co-located test.
- Do not add production runtime flags or hooks to support harness testing. The harness exercises real workflow logic through explicit inputs and context overrides.
- Export only stable types and the `WorkflowTestHarness` class through `testing-api.ts`; keep internal utilities unexported.
