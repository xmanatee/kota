# Step Validators

This directory contains per-step-type workflow validation functions, extracted from `validation-steps.ts`.

- Each file validates one step type: agent, code, emit, parallel group, restart, tool, or trigger.
- `index.ts` re-exports all validators and `VALID_MODEL_IDS` — import from there, not individual files.
- Keep each validator focused on its step type; shared primitives belong in `../validation-primitives.ts`.
