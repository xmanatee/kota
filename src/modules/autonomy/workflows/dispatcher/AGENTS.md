# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Events emitted:
- `autonomy.queue.available` — there is local queued work to pull or promote
- `autonomy.inbox.available` — inbox has items to sort
- `autonomy.queue.empty` — inbox is empty and there is no local queued work
- `autonomy.queue.thin` — only a one-item backlog tail remains, so the future queue should be refreshed soon
