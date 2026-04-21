# Separate active workflow state from last-completed workflow state

During an active explorer run, `.kota/workflow-state.json` reported the active
run id as `workflows.explorer.lastRunId` while retaining the previous completed
run's `lastCompletedAt` and `lastStatus`. That mixes two different concepts.

Why it matters:
- Status/dashboard surfaces can show a run as both current and previously
  successful.
- Operators debugging long runs may trust stale status fields.
- Automated monitors may compare `lastRunId` with a completion status that
  belongs to another run.

Desired direction:
- Represent active/latest-started and last-completed workflow state separately,
  or clear completion fields when `lastRunId` advances to a running run.
- Add a small state persistence check covering a running workflow followed by
  completion/interruption.

