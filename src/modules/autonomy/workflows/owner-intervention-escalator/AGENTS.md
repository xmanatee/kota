# Owner Intervention Escalator

Code-only monitor that turns recurring owner-question correction or stale-prompt
patterns into one evidence-backed repair task per stable fingerprint.

- Read only owner-question records and the owner-intervention report aggregation.
- Keep grouping deterministic: task or task family, then workflow, then source.
- Treat legacy, unknown, setup-only, and provider-only records as reportable
  context, not auto-created repair work.
- Keep owner answer bodies, prompts, secrets, diffs, and cost fields out of
  generated tasks, reports, and attention digest payloads.
