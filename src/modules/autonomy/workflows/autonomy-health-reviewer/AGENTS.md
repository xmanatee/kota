# Autonomy Health Reviewer

This workflow consumes typed `autonomy.health.signal` events and converts
concrete failures or repeated health patterns into bounded follow-up actions.

- Keep this workflow deterministic and code-only in v1.
- Do not expose raw prompts, tool payloads, secrets, or cost ranking context
  through review artifacts, attention digests, or improver inputs.
- A single warning remains review evidence; it does not become a durable issue.
  Admit an error/critical outcome immediately, a warning after repeated
  observation, or any later update/clear for an existing durable issue.
- The improver owns the AI disposition and the shared generated-work
  materializer owns any resulting task or owner question. No disposition is
  required to create work.
- An explicit source clear resolves the stable generated-work proposal without
  another AI decision. Any linked task move is staged in the run repository;
  the staged `autonomy-health-review-publication` `repository: none` follow-up
  owns canonical issue and owner-question finalization plus attention.
- Batch by typed health labels and scope; avoid hardcoded workflow-name
  allowlists.
- Treat health signals as explicit `present` / `changed` / `cleared`
  observations. The durable autonomy-issue projection owns current lifecycle
  and cross-source links; absence from a batch or bounded audit never clears an
  issue or dismisses its owner question.
