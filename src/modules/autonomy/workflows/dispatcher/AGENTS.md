# Dispatcher Workflow

Runs on `runtime.idle`, assesses repo state, and emits condition-based events.
This is the only autonomy workflow that listens to `runtime.idle`.

Keep routing decisions semantic: emit events that describe repo conditions, not
which workflow should run next. The event catalog lives in code.

Progress reflection observes committed task transitions and resolved owner
decisions. It emits one revisioned request only for an accepted strategic
boundary. Automatic revisions use a latest-only event distinct from lossless
explicit requests, and the progress-reviewer runtime state watermark rejects
consumed revisions. Ordinary source/build commits stay quiet. Scope reflection
compares durable guidance with the authoritative resolved scope-policy
snapshot, never raw scope config. A queued onboarding run re-reads current
inputs instead of adding a replacement; deferred pending input resumes only
after cleanup, and later changes emit through their own latest-only event.
Repository-free observe scopes retain this reflection even when Git inspection
is unavailable; postures that can write remain parked without a clean Git root.
Dispatcher therefore declares `repository: "none"` and reads canonical scope
state. Builder events bind immutable task digests that writers revalidate, and
semantic reservations use runtime-owned compare-and-set state.

Research retry is routed by `autonomy.blocked-research.attemptable`, not by
generic actionable queue availability. Emit it only when blocked research
resources are currently attemptable; missing browser capability and unchanged
retry fingerprints should stay quiet.

Builder dispatch requires the complete resolved scope-policy decision to allow
autonomous repository writes. Observe/ask, proposed-task, disabled improvement,
and denied or confirmation-required builder authority keep tasks visible
without admitting builder runs. Path-bounded policies are evaluated against
their projected writable roots rather than the enclosing scope root.
