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

Client identity combines project and daemon identity with dashboard readiness.
Clients render dashboard controls only when that typed capability is available.

## Scope Runtime

Scope ids are canonical; project ids are aliases for directory-backed scopes.
Config seeds the registry and `ScopeLifecycleService` mutates it. Persist before
activation, compensate on failure, and recheck live-resource blockers before
removal. Trust and policy changes are atomic; untrust quarantines control work,
aborts workflows, and restarts before repository authority changes.

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
