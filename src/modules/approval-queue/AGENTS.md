# Approval-Queue Module

Owns the `kota approval` CLI surface and the underlying `ApprovalQueue` class used by the tool-runner and workflow code.

- Provides `ApprovalQueue` state management, operator CLI subcommands, and HTTP route handlers for approvals.
- `supervised` session autonomy is the main producer: the tool-runner queues
  every non-safe tool for this mode regardless of the tool's guardrail policy.
  Operators resolve queued approvals through this module's CLI and routes.
- Approval events and autonomy mode are orthogonal operator surfaces. Do not
  extend approval endpoints to change a session's mode — mode changes go
  through the daemon control session endpoint (`PATCH /sessions/:id`) owned by
  daemon-ops. A single approval represents a single tool call; a mode change
  affects how future tool calls are gated.
