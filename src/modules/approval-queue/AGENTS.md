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
- Treat project-local approval storage as an adversarial boundary. The queue
  accepts only daemon-owned real directories and single-link regular records;
  reads are no-follow and status rewrites stay bound to the verified no-follow
  descriptor through mutation and final identity validation.
- Approval events and autonomy mode are orthogonal operator surfaces. Do not
  extend approval endpoints to change a session's mode — mode changes go
  through the daemon control session endpoint (`PATCH /sessions/:id`) owned by
  daemon-ops. A single approval represents a single tool call; a mode change
  affects how future tool calls are gated.
