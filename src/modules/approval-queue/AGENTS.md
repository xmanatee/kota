# Approval-Queue Module

Owns the `kota approval` CLI surface and the underlying `ApprovalQueue` class used by the tool-runner and workflow code.

- `queue.ts` — `ApprovalQueue` state management, shared with core runtime.
- `cli.ts` — operator CLI subcommands for listing, approving, and rejecting pending tool calls.
