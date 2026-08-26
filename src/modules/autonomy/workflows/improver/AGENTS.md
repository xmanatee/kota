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
- Do not replay AI review without a new decision-request transition.
