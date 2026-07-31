# Approval-Queue Module

Owns the `kota approval` CLI surface and the underlying `ApprovalQueue` class used by the tool-runner and workflow code.

- Provides `ApprovalQueue` state management, operator CLI subcommands, and
  HTTP route handlers for approvals on both surfaces: the public
  `/api/approvals*` routes contributed via `KotaModule.routes` and the
  daemon-control `/approvals*` routes contributed via
  `KotaModule.controlRoutes`. `routes.ts` is the public module surface; the
  shared handler family and registration wrappers live in focused
  `route-*` siblings so the wire contract stays local without one oversized
  file.
- `supervised` session autonomy is the main producer: the tool-runner queues
  every non-safe tool for this mode regardless of the tool's guardrail policy.
  Operators resolve queued approvals through this module's CLI and routes.
- Approval records have one required kind: executable `tool_call` or
  non-executable `workflow_gate`. Approval routes return a typed resolution
  for either tool execution or gate approval; clients must render that
  resolution instead of inferring execution from a label or optional field.
- Treat project-local approval storage as an adversarial boundary. The queue
  accepts only daemon-owned real directories and single-link regular records;
  reads are no-follow and status rewrites stay bound to the verified no-follow
  descriptor through mutation and final identity validation. Terminal records
  carry an HMAC from a live queue's daemon-held key. File-backed `get`/`list`
  remain inspection surfaces; code that authorizes workflow continuation or a
  later side effect must use `getWithAuthenticatedResolution`, which fails
  closed on tampering and when a prior daemon lifetime's key is unavailable.
  The live queue also binds each original pending snapshot in daemon-held HMAC
  state; automatic expiry must verify that binding before it can sign a timeout
  resolution. Unverifiable stale records stay pending and are reported as
  blocked; the daemon sweep logs that fail-closed state without terminating
  after pending-file edits or restart.
- Approval events and autonomy mode are orthogonal operator surfaces. Do not
  extend approval endpoints to change a session's mode — mode changes go
  through the daemon control session endpoint (`PATCH /sessions/:id`) owned by
  daemon-ops. A single approval represents a single tool call; a mode change
  affects how future tool calls are gated.
- Local tool-call approvals bind the queue-time registry generation and
  declaration/effect fingerprint. Preflight rejects drift and leases the exact
  definition and runner execution must use, even if the mutable registry
  changes after preflight.
