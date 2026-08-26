# Autonomy Health Reviewer

This workflow consumes typed `autonomy.health.signal` events and converts
deduped health patterns into bounded follow-up actions.

- Keep this workflow deterministic and code-only in v1.
- Do not expose raw prompts, tool payloads, secrets, or cost ranking context
  through review artifacts, attention digests, or improver inputs.
- Project each source observation into one durable issue transition. The
  improver owns the single AI disposition and the shared generated-work
  materializer owns any resulting task or owner question.
- An explicit source clear resolves the stable generated-work proposal without
  another AI decision. This workflow owns the resource-serialized issue state
  transition and stages task, decision, attention, materialization, and
  owner-question mutation events in the same run transaction.
- Batch by typed health labels and scope; avoid hardcoded workflow-name
  allowlists.
- Treat health signals as explicit `present` / `changed` / `cleared`
  observations. The durable autonomy-issue projection owns current lifecycle
  and cross-source links; absence from a batch or bounded audit never clears an
  issue or dismisses its owner question.
