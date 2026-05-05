/**
 * Approval-queue namespace client contract.
 *
 * The approval-queue module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/filter/mutate-result types and the
 * `ApprovalsClient` interface that the `KotaClient` aggregate composes.
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota approval` CLI subcommands consume it through
 * `ctx.client.approvals` or by importing these types from
 * `#modules/approval-queue/client.js`.
 */

import type {
  ApprovalStatus,
  PendingApproval,
} from "#core/daemon/approval-queue.js";

export type ApprovalsListResult = {
  approvals: PendingApproval[];
};

/**
 * Filter for `ApprovalsClient.list`.
 *
 * `status` defaults to `"pending"` so the common "what needs my
 * attention?" call stays a one-liner. Pass `"all"` to include every
 * status (used by `kota approval history` and by callers that need to
 * count or render resolved items).
 */
export type ApprovalListFilter = {
  status?: ApprovalStatus | "all";
};

/** Result of an approval mutation (`approve`, `reject`). */
export type ApprovalMutateResult =
  | { ok: true; approval: PendingApproval }
  | { ok: false; reason: "not_found" };

/**
 * Approval-queue operations.
 *
 * `list` reads the queue (filterable by status). `approve` / `reject`
 * mutate a single pending entry; the daemon implementor talks to the
 * running daemon's queue, and the local implementor talks to the
 * in-process queue. Tool execution that follows a successful approve
 * stays in the CLI — the contract carries only the queue-state change.
 */
export interface ApprovalsClient {
  list(filter?: ApprovalListFilter): Promise<ApprovalsListResult>;
  approve(id: string, note?: string): Promise<ApprovalMutateResult>;
  reject(id: string, reason?: string): Promise<ApprovalMutateResult>;
}
