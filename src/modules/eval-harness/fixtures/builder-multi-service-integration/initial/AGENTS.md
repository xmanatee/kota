# Multi-Service Fixture Project

This fixture is a small local integration project.

- Keep it dependency-free and use built-in Node.js APIs.
- Fix the service contract instead of bypassing either component.
- Do not edit `scripts/check-integration.mjs`; it is the fixture-owned scorer.
- The task is complete only when the integration command starts the API,
  runs the worker, and writes `integration-result.json`.
