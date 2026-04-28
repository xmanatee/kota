# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Keep routing decisions semantic: emit events that describe repo conditions, not
which workflow should run next. The event catalog lives in code.
