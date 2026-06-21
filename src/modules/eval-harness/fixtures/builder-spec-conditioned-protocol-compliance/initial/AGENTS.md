# Spec-Conditioned Protocol Fixture

This fixture is a tiny dependency-free Node project for the KOTA eval harness.

- `SPEC.md` is the normative source. Do not edit it.
- `scripts/check-protocol.mjs` and `scripts/check-protocol/*.mjs` are the fixture verifier. Do not edit them.
- `test/protocol-generic.test.mjs` covers visible defensive cases only.
- Implement protocol behavior in `src/protocol-handler.mjs`.
- Write compliance evidence to `spec-compliance-result.json`.
- Move the seeded task from `data/tasks/ready/` to `data/tasks/done/` when complete.
