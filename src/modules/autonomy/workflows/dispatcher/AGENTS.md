# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events
that trigger other autonomy workflows. This is the only workflow that listens
to `runtime.idle` — all other autonomy workflows trigger on semantic events.

Events emitted:
- `autonomy.queue.available` — ready queue has actionable tasks (→ builder)
- `autonomy.inbox.available` — inbox has items to sort (→ inbox-sorter)
- `autonomy.queue.empty` — queue and inbox are empty (→ explorer)
