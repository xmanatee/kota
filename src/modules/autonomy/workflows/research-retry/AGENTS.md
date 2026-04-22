# Research-Retry Workflow

This workflow re-attempts inaccessible sources in blocked research tasks.
A task is a retry candidate when it sits in `data/tasks/blocked/` and its
body carries a `## Resources` section with HTTP(S) URLs. The oldest
candidate is retried first.

- Triggered on `autonomy.queue.available` and gated on a candidate being
  present (`candidateCount > 0`) plus a clean worktree. No candidates → no
  agent run.
- Agent writes inside `data/tasks/`, `data/inbox/`, and
  `src/modules/autonomy/` only. Outcome is one of:
  - task progresses (advance or done)
  - task stays blocked with honest fresh status about which sources
    remain inaccessible
  - task is dropped with a recorded rationale when further retries add no
    value.
- The workflow honors the recovery contract: it resets the worktree on
  `runtime.recovered` and skips the agent step on recovery triggers.
- The agent's browser-tool output flows through `injection-defense`; the
  prompt reminds the agent to treat annotated payloads as untrusted.
