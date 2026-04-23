# Research-Retry Workflow

This workflow re-attempts inaccessible sources in blocked research tasks.
A task is a retry candidate when it sits in `data/tasks/blocked/` and its
body carries a `## Resources` section with HTTP(S) URLs.

- Triggered on `autonomy.queue.available` and gated on a candidate being
  attemptable plus a clean worktree. The workflow honors the recovery
  contract: it resets the worktree on `runtime.recovered` and skips the
  agent step on recovery triggers.
- Agent writes inside `data/tasks/`, `data/inbox/`, and
  `src/modules/autonomy/` only. Outcome is one of:
  - task progresses (advance or done)
  - task stays blocked with honest fresh status about which sources
    remain inaccessible
  - task is dropped with a recorded rationale when further retries add no
    value.
- The agent's browser-tool output flows through `injection-defense`; the
  prompt reminds the agent to treat annotated payloads as untrusted.

## Skip Contract

`inspect-candidates` walks blocked candidates oldest-first and selects the
first one that is *attempttable*. If none qualify the agent step is
skipped and no commit is produced. A candidate is unattempttable when:

- **`capability-absent`** — every URL in the candidate's `## Resources`
  list requires a browser capability the runtime cannot provide. The
  workflow classifies each URL as `plain-http`, `js-rendered`, or
  `x-post`. `js-rendered` requires `isPlaywrightAvailable()`; `x-post`
  also requires a configured `modules.browser.storageStatePath` whose
  file exists on disk. When the candidate has no readable URL under the
  current capability state, retrying would only re-confirm the same
  blocker and no commit happens.
- **`no-change-since-last-attempt`** — the candidate body carries a
  `<!-- research-retry-attempt: fingerprint=… attempted_at=… -->` marker
  whose fingerprint matches the current resource set. The marker is
  written by the workflow's own `mark-attempt` step after each successful
  agent run, so the next cycle sees that the URL set has not changed and
  bails before invoking the agent. When the agent dispositions a URL (or
  an operator edits `## Resources`), the URL set changes, the
  fingerprint diverges from the marker, and the candidate is attempted
  again.

The skip evaluation surfaces in `<run-dir>/steps/inspect-candidates.json`
under `examined[]` so an operator reading the artifact can see exactly
why each candidate was passed over. Skipping is not the same as marking
a task done — a skipped run leaves the candidate untouched.

The marker is written by the workflow code, not by the agent. The agent
prompt does not need to know about the marker; it only owns the honest
status notes inside the task body.
