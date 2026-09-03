# Scope Improver Workflow

Owns scope-local improvement discovery from explicit requests, initial
onboarding, and material durable guidance or policy changes.

- Read scoped guidance and the machine-owned resolved policy snapshot. Do not
  infer typed domains from directory names or use schedules, failures, or build
  volume as improvement evidence.
- Resolve scope-improvement posture from authoritative scope policy into the
  module's runtime config. Observe posture converts task proposals into owner
  questions; only build posture permits dispatcher to admit builder work.
- Domain state records consumed and pending semantic fingerprints. It is an
  admission watermark for automatic inputs, not a workflow queue, run owner, or
  repository lock; `RunStateDatabase` owns durable run admission and resources.
- Disabled configuration and task-writer policy denial publish a deferred
  semantic disposition. Dispatcher leaves that fingerprint parked until the
  authoritative configuration or policy fingerprint changes, then redelivers
  it with the next delivery attempt.
- Confirmation-required task-write policy resolves the effective posture to
  observe/ask. It may create an owner question, but neither the review nor its
  isolated writer may create a task file until live authority resolves to allow.
- Explicit requests remain lossless. Automatic inputs use their typed latest
  semantic boundary and are rechecked against current guidance at execution.
- The review workflow is repository-free, reads the canonical scope root, and
  can therefore observe non-Git directories. Task proposals delegate to the
  `scope-improvement-actions` writer workflow; `RunLifecycle` owns its isolation
  and resources, and `IntegrationQueue` validates and publishes its changes.
  The writer re-resolves enabled state, effective posture, and task-write
  authority from its own live step snapshot before changing the task queue.
- Non-Git observe scopes still compare durable guidance and policy fingerprints
  after onboarding. Git cleanliness gates only repository-writing postures.
- Scope-owned improvement config is a strict boundary. Malformed explicit
  fields park automation; they never inherit permissive defaults.
- Scope improvement is proposal-only for product source. Use normal task
  creation or owner questions; builder implements accepted source changes.
- Artifacts record the trigger, fingerprint, evidence, recommendations, actions,
  and semantic consumption disposition. The staged
  `scope-improvement-publication` `repository: none` follow-up updates the
  domain watermark and owner-question queue after integration.
- Test semantic admission and observable actions without treating the domain
  fingerprint JSON as the run queue or duplicating runtime lifecycle tests.
