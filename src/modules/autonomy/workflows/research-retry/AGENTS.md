# Research-Retry Workflow

Re-attempts inaccessible sources in blocked research tasks when the current
runtime can reach them.

- Trigger only on `autonomy.blocked-research.attemptable` and recheck the
  candidate before launching the agent.
- The definition declares repository write access and task validation.
  `RunLifecycle` owns the isolated sandbox, restart reconciliation, commit, and
  cleanup; the workflow has no recovery trigger or shared-checkout reset step.
- Agent writes stay limited to task and inbox data. The result must state
  honestly whether the source became accessible, remained blocked, or no longer
  justifies retrying.
- Browser output passes through injection defense and remains untrusted input.
- Code collects sources through `workflow.runTool`; the agent reads its screened
  output and does not require native access to KOTA tools. Source-access blocked
  contracts use ordinary Markdown URLs, preferring pending URLs in `Blocked on`.
- Retry records cover actual per-source calls, not the whole URL set. Unchanged
  access waits 24 hours; refreshed profile metadata permits an immediate retry
  for browser-attempted sources, not unrelated plain-HTTP reads.
  Admission requires both package/profile readiness and a registered tool allowed
  by scope policy and the shared writer-effect contract. Execution rechecks live
  authority; denied or confirmation-required sources remain blocked, not retried.
- Its unbounded repair loop contributes the selected candidate evidence to the
  shared continuation authority. Because research retry has no task-decomposition
  consumer, a split or deferral preserves and yields the same run lineage.
- A skip leaves the candidate unchanged and records why. It is not task
  completion and does not require special Git handling.
