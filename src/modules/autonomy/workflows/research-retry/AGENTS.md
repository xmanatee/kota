# Research-Retry Workflow

This workflow re-attempts inaccessible sources in blocked research tasks.
A retry candidate is a blocked task with resource URLs that the current runtime
can attempt.

- Triggered on `autonomy.blocked-research.attemptable`, the dispatcher event
  for blocked research tasks whose current resources are retryable in the
  available runtime. The workflow still rechecks candidate availability and a
  clean worktree before invoking the agent. It honors the recovery contract:
  it resets the worktree on `runtime.recovered` and skips the agent step on
  recovery triggers.
- Agent writes stay limited to task/inbox/autonomy data. The outcome must
  honestly reflect whether the source became accessible, remained blocked, or
  no longer justifies retrying.
- The agent's browser-tool output flows through `injection-defense`; the
  prompt reminds the agent to treat annotated payloads as untrusted.

## Skip Contract

The code step selects the oldest attemptable candidate and skips without a
commit when retrying would only repeat a known capability failure or unchanged
resource set. Skipping is not completion; a skipped run leaves the candidate
untouched and records why in the run artifact.

The marker is written by the workflow code, not by the agent. The agent
prompt does not need to know about the marker; it only owns the honest
status notes inside the task body.
