# Progress Reviewer Workflow

This workflow owns bounded evidence review for scoped activity.

- Collect structured evidence first, then let the reviewer assess it.
- Automatic reviews run only for a parked queue after a task transition,
  strategic completion, blocked/dropped task, or owner-decision resolution.
  Explicit requests remain available. Schedules, completion counts, and build
  commits are not progress signals.
- Consume each automatic semantic input revision once. Automatic requests use
  their own latest-only event slot, while the explicit request event is
  lossless, so owner/system requests cannot replace or be replaced by a
  superseded automatic revision.
- Reject consumed or superseded automatic revisions through the workflow's
  canonical `triggerAdmission` watermark before pending-queue insertion.
  Delivery-attempt keys dedupe replayed events while allowing cleanup-deferred
  input to receive a fresh delivery.
- If canonical tracked state becomes dirty before review, park the unconsumed
  revision and let dispatcher redeliver it after cleanup; never advance the
  consumption watermark for a skipped run.
- Treat the complete current open queue, anchors, dependencies, durable issues,
  recovery projection, and owner decisions as canonical state. Recent terminal
  task history can add context but must not stand in for queue truth.
- Bind runtime-authored evidence to its pre-agent digest. The reviewer receives
  a machine-enforced per-run `agent-output/` directory while sibling evidence,
  step state, and run metadata remain runtime-owned inputs rather than
  agent-authored authority. Its project write scope is `deny-all`.
- Keep the reviewer evaluative: it may create normal follow-up tasks or owner
  questions, but it must not directly mutate product code.
- Every review artifact must state its scope, trigger kind, evidence window,
  included evidence, excluded evidence, and applied actions.
- Dedupe before creating tasks or owner questions so recurring reviews do not
  spam the queue.
- Reconcile generated tasks and owner questions through the shared proposal
  lifecycle when canonical state disproves their premise.
