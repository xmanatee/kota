# Cross-Hierarchy Debugging Fixture Project

This fixture is a tiny signal-routing project.

- Keep it dependency-free and use built-in Node.js APIs.
- Treat `scripts/check-debug-trace.mjs`, `scripts/debug-trace-*.mjs`, and
  `test/signal-flow.test.mjs` as the fixture-owned verifier; do not edit them.
- The visible failure appears in the gateway layer, but the durable fix belongs
  upstream in `src/channel-registry.mjs`.
- Write `debug-trace-result.json` as structured evidence of the failing
  command, symptom layer, root-cause layer, causal path, and verification
  result.
