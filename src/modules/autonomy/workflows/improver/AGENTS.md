# Issue Disposition Workflow

This workflow is the single AI decision path for durable autonomy issues.

- Trigger from a new, reopened, or materially revised issue transition, or a
  bounded same-revision reconciliation attempt after the prior owner failed.
- Keep the agent read-only. Source implementation belongs to builder.
- Route task and owner-question proposals through the shared generated-work
  transaction using the issue key as stable proposal identity. Repository task
  changes stage in the writer; owner-question effects and issue disposition
  projection publish through the staged `improver-disposition-publication`
  `repository: none` follow-up.
- Bind the staged disposition to the issue's owner fingerprint. Recheck that
  fingerprint against canonical scope state immediately before integrating
  task changes and before finalizing any follow-up owner effects.
- Repeated evidence enriches projection provenance without another review or
  attention item.
- Inspect the linked evidence, current owner, implementation, and related queue
  work before acting. Prefer one existing owner over parallel repair tasks.
- Do not treat a static metric, trajectory heuristic, or review-shape score as
  sufficient evidence of a repair need.
- Do not replay AI review without a new decision-request transition.
- `doctor.fix` is the sole deterministic recovery action. Its allowlist and
  idempotent settled-state verification run before disposition publication;
  arbitrary code changes remain builder-owned tasks.
- Exhausted investigation retries publish the issue's durable `attention`
  disposition. A terminal run by itself is never an owner.
- Investigation backoff is a future-eligible durable improver run. Completion
  and one-shot workflow-runtime startup reconciliation admit that owner; idle
  polling does not own or re-drive issue investigation.
