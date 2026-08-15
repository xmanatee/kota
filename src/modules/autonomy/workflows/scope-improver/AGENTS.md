# Scope Improver Workflow

This workflow owns continuous, scope-local improvement discovery.

- Keep scope state under the scope directory's `.kota/scope-improvement/`.
- Discover candidates from structured scope inputs before recommending actions.
- Read scoped `AGENTS.md` files as guidance; do not infer typed domains from
  directory names such as travel, code, planning, or personal notes.
- Run only from an explicit request, the idempotent initial-onboarding request,
  or a changed durable guidance/policy fingerprint. The policy portion comes
  from the machine-owned resolved scope-policy snapshot, never project config.
  Builds, schedules, failures, DLQs, and recovery are not scope-improvement
  evidence.
- A successful live scope registration resolves that scope's policy authority
  and reserves/emits its initial request. Canonical pre-queue admission rejects
  consumed or superseded fingerprints; delivery-attempt keys preserve honest
  cleanup redelivery without accepting an old event replay.
- Prefer normal task creation or owner questions when an improvement needs
  judgment.
- Scope improvement is proposal-only. Builder implements accepted source
  changes through the normal task path; this workflow never edits source.
- Keep the consumed and pending fingerprints in the scope state so unchanged
  and already-queued automatic requests are no-ops.
- Preserve explicit and initial-onboarding requests losslessly. Later automatic
  content/policy changes use a separate latest-only event slot, so neither kind
  can overwrite the other.
- Track queued versus cleanup-deferred automatic fingerprints. Dispatcher
  redelivers only the deferred latest fingerprint once the canonical worktree
  is clean; explicit reviews never advance this automatic watermark.
- Re-read canonical guidance/policy inputs when an automatic request executes;
  a queued payload must not consume a fingerprint made stale before execution.
- Artifacts must explain the semantic trigger, fingerprint, evidence,
  recommendation, action, and consumption decision for later review.
