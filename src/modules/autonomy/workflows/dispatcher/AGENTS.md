# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Keep routing decisions semantic: emit events that describe repo conditions, not
which workflow should run next. The event catalog lives in code.

Progress reflection observes committed task transitions and resolved owner
decisions. It emits one revisioned request only for an accepted strategic
boundary; an unconsumed input deferred by canonical dirt is redelivered after
cleanup. Automatic revisions use a latest-only event distinct from lossless
explicit requests. Ordinary source/build commits stay quiet. Scope reflection
compares durable guidance with the authoritative resolved scope-policy
snapshot, never raw project config. A queued onboarding run re-reads current
inputs instead of adding a replacement; deferred pending input resumes only
after cleanup, and later changes emit through their own latest-only event.

Research retry is routed by `autonomy.blocked-research.attemptable`, not by
generic actionable queue availability. Emit it only when blocked research
resources are currently attemptable; missing browser capability and unchanged
retry fingerprints should stay quiet.
