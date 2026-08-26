# Scope Improver Workflow

Owns scope-local improvement discovery from explicit requests, initial
onboarding, and material durable guidance or policy changes.

- Read scoped guidance and the machine-owned resolved policy snapshot. Do not
  infer typed domains from directory names or use schedules, failures, or build
  volume as improvement evidence.
- Domain state records consumed and pending semantic fingerprints. It is an
  admission watermark for automatic inputs, not a workflow queue, run owner, or
  repository lock; `RunStateDatabase` owns durable run admission and resources.
- Explicit requests remain lossless. Automatic inputs use their typed latest
  semantic boundary and are rechecked against current guidance at execution.
- The workflow declares repository write access because it may create tasks.
  `RunLifecycle` owns isolation and resources; `IntegrationQueue` validates and
  publishes repository changes.
- Scope improvement is proposal-only for product source. Use normal task
  creation or owner questions; builder implements accepted source changes.
- Artifacts record the trigger, fingerprint, evidence, recommendations, actions,
  and semantic consumption disposition. The staged
  `scope-improvement-publication` `repository: none` follow-up updates the
  domain watermark and owner-question queue after integration.
- Test semantic admission and observable actions without treating the domain
  fingerprint JSON as the run queue or duplicating runtime lifecycle tests.
