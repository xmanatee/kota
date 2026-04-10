# Approval-Queue Module

Owns the `kota approval` CLI surface and the underlying `ApprovalQueue` class used by the tool-runner and workflow code.

- `queue.ts` — `ApprovalQueue` state management, shared with core runtime.
- `cli.ts` — operator CLI subcommands for listing, approving, and rejecting pending tool calls.
- `routes.ts` — HTTP route handlers for `/api/approvals` and approval actions; contributed via `KotaModule.routes`.
- `routes.test.ts` — unit tests for the HTTP route handlers (covers both daemon-proxy and standalone paths).
