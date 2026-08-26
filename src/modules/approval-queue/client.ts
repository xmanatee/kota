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
  ApprovalClientProjection,
  ApprovalStatus,
  PendingApproval,
} from "#core/daemon/approval-queue.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";

export type ApprovalsListResult = {
  approvals: ApprovalClientProjection[];
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

export type ApprovalScopeSelection = ScopeSelector;

export type ApprovalReviewReceipt = {
  id: string;
  digest: string;
};

export type ApprovalExecutionProjection = {
  status: "succeeded" | "failed";
  output: {
    redacted: true;
    reason: "tool-io";
    bytes?: number;
  };
};

export type ApprovalResolutionProjection =
  | {
      kind: "workflow_gate_approved";
    }
  | {
      kind: "tool_execution";
      execution: ApprovalExecutionProjection;
    };

type ApprovalMutationFailure = {
  ok: false;
  reason:
    | "invalid_id"
    | "not_found"
    | "input_unavailable"
    | "scope_mismatch"
    | "review_mismatch";
};

export type ApprovalApproveResult =
  | {
      ok: true;
      approval: PendingApproval;
      resolution: ApprovalResolutionProjection;
    }
  | ApprovalMutationFailure;

export type ApprovalRejectResult =
  | {
      ok: true;
      approval: PendingApproval;
    }
  | ApprovalMutationFailure;

/**
 * Approval-queue operations.
 *
 * `list` reads the queue (filterable by status). `approve` / `reject`
 * mutate a single pending entry; the daemon implementor talks to the
 * running daemon's queue, and the local implementor talks to the
 * in-process queue. Executable approvals run in the daemon before returning
 * a redacted execution projection; workflow gates return an explicit
 * non-executable resolution. Local approvals use the same preflight and
 * lease binding, so long-lived channels cannot confuse those outcomes.
 */
export interface ApprovalsClient {
  list(filter?: ApprovalListFilter): Promise<ApprovalsListResult>;
  approve(
    id: string,
    reviewDigest: string,
    note?: string,
    scopeSelector?: ApprovalScopeSelection,
  ): Promise<ApprovalApproveResult>;
  reject(
    id: string,
    reason?: string,
    scopeSelector?: ApprovalScopeSelection,
  ): Promise<ApprovalRejectResult>;
}
