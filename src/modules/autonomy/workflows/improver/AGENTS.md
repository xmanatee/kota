# Issue Disposition Workflow

This workflow is the single AI decision path for durable autonomy issues.

- Trigger only from a new, reopened, or materially revised issue transition.
- Keep the agent read-only. Source implementation belongs to builder.
- Route task and owner-question proposals through the shared generated-work
  transaction using the issue key as stable proposal identity. Repository task
  changes stage in the writer; owner-question effects and issue disposition
  projection publish through the staged `improver-disposition-publication`
  `repository: none` follow-up.
- Repeated evidence enriches projection provenance without another review or
  attention item.
- Inspect the linked evidence, current owner, implementation, and related queue
  work before acting. Prefer one existing owner over parallel repair tasks.
- Do not treat a static metric, trajectory heuristic, or review-shape score as
  sufficient evidence of a repair need.
- Do not replay AI review without a new decision-request transition.
