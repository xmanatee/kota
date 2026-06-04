# Scope Improver Workflow

This workflow owns continuous, scope-local improvement discovery.

- Keep scope state under the scope directory's `.kota/scope-improvement/`.
- Discover candidates from structured scope inputs before recommending actions.
- Read scoped `AGENTS.md` files as guidance; do not infer typed domains from
  directory names such as travel, code, planning, or personal notes.
- Prefer normal task creation or owner questions when an improvement needs
  judgment.
- Direct edits must be bounded by the scope improvement policy and limited to
  the configured write paths.
- Artifacts must explain the trigger, evidence, recommendation, action, and
  dedupe/throttle decision for later review.
