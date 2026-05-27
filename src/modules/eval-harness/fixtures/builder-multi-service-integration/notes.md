# Builder Multi-Service Integration

This replay-backed builder fixture seeds a tiny two-component Node project:

- `catalog-api` starts as a service process and serves catalog bundle data.
- `order-worker` consumes that API through a local request directory and writes
  `integration-result.json`.

The seeded bug is a stale API route contract in `src/catalog-routes.mjs`: the
worker requests `/api/bundles/starter-kit`, while the API initially serves
`/api/catalog/starter-kit`. The scorer starts both components, requires a
successful API request envelope through the expected route, and validates a
dynamic run token that is passed only to the API process. A hardcoded artifact
or a worker that bypasses the API cannot produce the token and request-log
evidence the scorer expects.

`node scripts/check-integration.mjs --self-test-shortcuts` exercises the
shortcut guard logic without mutating the fixture project.
