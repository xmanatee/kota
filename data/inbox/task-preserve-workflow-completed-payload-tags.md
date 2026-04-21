# Preserve workflow.completed payload tags without circular corruption

After interrupting the active explorer, the persisted pending attention-digest
run contained `trigger.payload.tags: "[Circular]"` instead of an array. That
looks like queue persistence is serializing an event payload after a circular
reference was introduced.

Why it matters:
- Trigger payloads should remain typed data, not lossy debug strings.
- Downstream workflows may rely on tags or payload shape for routing and
  reporting.
- Persisted queue state should be replayable after daemon restart without hidden
  shape corruption.

Desired direction:
- Find where `workflow.completed` payloads are composed and persisted.
- Preserve plain arrays/objects in workflow trigger payloads.
- Add a regression check that completed-workflow follow-up events persist tags
  as data, including interrupted runs.

