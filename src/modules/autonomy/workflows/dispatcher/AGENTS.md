# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Keep routing decisions semantic: emit events that describe repo conditions, not
which workflow should run next. The event catalog lives in code.

Research retry is routed by `autonomy.blocked-research.attemptable`, not by
generic actionable queue availability. Emit it only when blocked research
resources are currently attemptable; missing browser capability and unchanged
retry fingerprints should stay quiet.
