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
- A skip leaves the candidate unchanged and records why. It is not task
  completion and does not require special Git handling.
