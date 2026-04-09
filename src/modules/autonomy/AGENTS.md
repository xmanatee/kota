# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows inside this module.
- Shared helpers used only by these workflows belong here too.
- Do not recreate a parallel workflow catalog in core just to surface these workflows.

## Files

- `index.ts` — contributes the autonomy workflows and their paired agents by discovering the local `workflows/` directories.
- `workflows/` — one directory per autonomy workflow, with code, prompt assets, and tests kept together.
- `shared.ts` and `commit.ts` — small helpers shared only by the autonomy workflows.
- `autonomous-loop.integration.test.ts` — end-to-end test of the autonomy handoff path.
