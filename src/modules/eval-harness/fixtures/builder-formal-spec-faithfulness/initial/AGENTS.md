# Formal Spec Faithfulness Fixture

This fixture is a tiny dependency-free Node project for the KOTA eval harness.

- `REQUIREMENTS.md` and `data/*.json` are the source packet. Do not edit them.
- `scripts/check-spec-faithfulness.mjs` and `scripts/check-spec-faithfulness/*.mjs` are the verifier. Do not edit them.
- Implement the executable contract in `src/spec-contract.mjs`.
- Write evidence to `spec-faithfulness-result.json`.
- Move the seeded task from `data/tasks/` to `data/tasks/archive/` when complete.
