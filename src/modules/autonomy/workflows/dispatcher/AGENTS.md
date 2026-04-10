# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Events emitted:
- `autonomy.queue.available` — ready queue has actionable tasks
- `autonomy.inbox.available` — inbox has items to sort
- `autonomy.queue.empty` — inbox is empty and there is no ready or backlog work
