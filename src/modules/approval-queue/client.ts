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
import type { ScopeSelector } from "#core/server/scope-selector.js";

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
export type ApprovalListFilter = ScopeSelector & {
  status?: ApprovalStatus | "all";
};

export type ApprovalProjectScope = ScopeSelector;

export type ApprovalExecutionProjection = {
  status: "succeeded" | "failed";
  output: {
    redacted: true;
    reason: "tool-io";
    bytes?: number;
  };
};

/** Result of an approval mutation (`approve`, `reject`). */
export type ApprovalMutateResult =
  | {
      ok: true;
      approval: PendingApproval;
      execution?: ApprovalExecutionProjection;
    }
  | { ok: false; reason: "invalid_id" | "not_found" | "input_unavailable" };

/**
 * Approval-queue operations.
 *
 * `list` reads the queue (filterable by status). `approve` / `reject`
 * mutate a single pending entry; the daemon implementor talks to the
 * running daemon's queue, and the local implementor talks to the
 * in-process queue. Daemon-backed approvals execute in the daemon before
 * returning a redacted projection; local approvals return the queue-state
 * change so the local CLI can execute the approved tool in-process.
 */
export interface ApprovalsClient {
  list(filter?: ApprovalListFilter): Promise<ApprovalsListResult>;
  approve(
    id: string,
    note?: string,
    project?: ApprovalProjectScope,
  ): Promise<ApprovalMutateResult>;
  reject(
    id: string,
    reason?: string,
    project?: ApprovalProjectScope,
  ): Promise<ApprovalMutateResult>;
}
