# Autonomy Health Reviewer

This workflow consumes typed `autonomy.health.signal` events and converts
deduped health patterns into bounded follow-up actions.

- Keep this workflow deterministic and code-only in v1.
- Do not expose raw prompts, tool payloads, secrets, or cost ranking context
  through review artifacts, attention digests, or improver inputs.
- Route local-code systemic patterns to normalized Meta repair tasks.
- Route operator/auth/provider/setup patterns to owner questions or attention
  entries instead of creating local repair tasks.
- Batch by typed health labels and scope; avoid hardcoded workflow-name
  allowlists.
- Treat health signals as explicit `present` / `changed` / `cleared`
  observations. The durable autonomy-issue projection owns current lifecycle
  and cross-source links; absence from a batch or bounded audit never clears an
  issue or dismisses its owner question.
