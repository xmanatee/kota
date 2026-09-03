# Daemon Core

This directory owns the long-lived runtime host: lifecycle, control plane,
sessions and channels, scheduling, scope hosting, and live state.

## Boundaries

- Autonomous execution belongs in `src/core/workflow/`; process-manager and
  operator CLI behavior belongs in the daemon-ops module.
- Modules extend the control plane through `KotaModule.controlRoutes`. Built-in
  and contributed routes use one `ControlRouteRegistration` table, one matcher,
  and loud collision detection.
- Module routes obtain workflow dispatch, metrics, and definitions through the
  registered provider seams rather than a `DaemonControlHandle`.
- Per-request signed routes may declare `bypassAuth`; all others use daemon
  bearer authentication.
- The unauthenticated health route exposes stable component state and timing
  only. Free-form agent and module diagnostics stay on authenticated operator
  or retained runtime-evidence surfaces.
- Clients use typed daemon wrappers for URLs, decoding, authentication,
  polling, and live updates. They never read daemon runtime files directly.
- Health diagnostics are observational; they do not become workflow state or
  control triggers.

## Structure

Keep `daemon.ts` a thin orchestrator. Lifecycle concerns live in focused
`daemon-*` siblings. Normal stop and failed start share `runDaemonShutdown`.
Use `daemon-chat-*` and `daemon-control-*` prefixes for those subsystems.

## Capabilities And Identity

Capability readiness comes from typed module-contributed sources. Each stable
capability id reports ready, unavailable, or initialization failure; duplicate
ids and probe exceptions fail loudly. Workflow triggering is daemon-owned and
is reported by the daemon itself.

Client identity combines scope and daemon identity with dashboard readiness.
Clients render dashboard controls only when that typed capability is available.

## Scope Runtime

Scope ids are canonical for both the global root and directory-backed scopes.
Config seeds the registry and `ScopeLifecycleService` mutates it. Persist before
activation, compensate on failure, and recheck live-resource blockers before
removal. Trust and policy changes are atomic; untrust quarantines control work,
aborts workflows, and restarts before repository authority changes.

External directory onboarding composes those owners through the single
`ScopeOnboardingService` inspect/plan/apply transaction. A prepared runtime
created by that transaction stays dispatch-closed until declared scope state and
machine authority commit; incomplete operations never quarantine a scope that
predated them and recover through retry or cancel. Scope-directory effects are
write-ahead claimed in the operation artifact before mutation, so an interrupted
claim remains rollback-owned. Transaction compensation restores unpublished
authority while dispatch is closed, so it does not enter the separate live
trust-revocation restart path. Task and inbox directories remain lazily owned by
the repo-task domain; onboarding never creates a parallel queue scaffold.
Git-backed onboarding accepts only the repository top-level because runtime
writer sandboxes check out that complete tree; nested selections cannot align a
scope-directory write boundary with the publication boundary.

Daemon routes, the typed `scopes` client namespace, terminal commands, and UI
planning actions delegate to that service. Successful onboarding publishes the
committed lifecycle boundary for the initial improvement workflow through a
write-ahead publication intent and stable dispatch identity; retries therefore
reuse one workflow admission. Readiness follows the selected posture's complete
production chain: review publication for every posture, the isolated task writer
for proposals, and dispatcher, builder, plus the active builder harness/provider
for autonomous builds.

Onboarding exposes one continuous-improvement posture: observe/ask, proposed
tasks, or autonomous builds. The service resolves it into the existing scope
autonomy and write policy and projects the resulting review and builder
authority to clients; setup or authority blockers keep completion dispatch
closed without unregistering the scope. Task-proposal readiness evaluates the
resolved policy decision for the scope's task queue, including bounded paths
and inherited local-write confirmation or denial. Only an allow decision can
activate initial task proposals; confirmation and denial remain explainable
onboarding blockers. For an already-hosted scope, confirmation-required
authority resolves workflow actions to observe/ask behavior. The
scope-improvement module contributes its
live configuration and complete task/builder decisions through the typed
authority provider; disabled improvement configuration parks initial activation,
and successful operations project later authority changes instead of replaying
their accepted choices. Path-bounded build authority is resolved from the
individual writable roots enforced by agent harnesses, while task-proposal
readiness independently requires authority over the task queue.

Durable schema-one onboarding operations migrate at the store boundary before
recovery. Their passive, supervised, or autonomous choice maps to observe,
propose, or build without widening the persisted autonomy or write boundary.

Observe onboarding does not require a Git repository because its improvement
review is repository-free. Task-proposal postures retain the Git-backed writer
requirement and report that capability blocker explicitly.

Scope-owned handlers resolve the live runtime through the runtime-scope
provider. Invalid selectors fail without cwd/default fallback. The daemon owns
one runtime module loader; sessions borrow it without replacing its provider or
event authority.

## Recoverability

The daemon is authoritative for live state. New state must either reconstruct
from a durable checkpoint after a crash or be explicitly disposable.

Durable state includes:

- daemon lifecycle state and stop reason;
- workflow admission, attempts, resources, processes, external effects, and
  terminal publications in `RunStateDatabase`;
- schedules, approvals, owner decisions, owner questions, and task files;
- conversation history plus daemon chat session bindings; and
- serve-owned session registrations, which re-register after daemon identity
  changes.

Run artifacts are execution evidence, never a second queue. Startup recovery
fences the prior daemon epoch, terminates verified owned processes, releases
attempt resources, and requeues the same run. Ambiguous process ownership puts
the run in `needs_attention` and pauses admission; recovery never broadcasts
synthetic workflow inputs or repairs a shared checkout.

Disposable state includes the live SSE reconnect window, quiet-hours digest
buffer, metric and health caches, subscriptions, and sweep timers. Clients
reconnect, durable event replay comes from the journal, and caches rebuild on
their next read or probe.
