import { isDeepStrictEqual } from "node:util";
import type { TransactionalRunState } from "#core/workflow/run-context.js";
import type { AutonomyIssueProjection } from "./autonomy-issue-projection.js";

export const AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT =
  "autonomy.issue-projection.materialization.requested";

export type AutonomyIssueProjectionMaterializationRequest = {
  stateRevision: number;
};

export function decodeAutonomyIssueProjectionMaterializationRequest(
  value: object,
): AutonomyIssueProjectionMaterializationRequest {
  const request = value as Partial<AutonomyIssueProjectionMaterializationRequest>;
  if (!Number.isSafeInteger(request.stateRevision) || request.stateRevision! <= 0) {
    throw new Error("autonomy issue projection materialization request is invalid");
  }
  return { stateRevision: request.stateRevision! };
}

export function stageAutonomyIssueProjection(args: {
  state: TransactionalRunState;
  key: string;
  revision: number;
  current: AutonomyIssueProjection;
  next: AutonomyIssueProjection;
  emit: (
    event: string,
    payload: Record<string, unknown>,
    options: { delivery: "on-run-success"; stepId: string },
  ) => void;
  stepId: string;
}): boolean {
  if (isDeepStrictEqual(args.current, args.next)) return false;
  args.state.compareAndSet(args.key, args.revision, args.next);
  const stateRevision = args.revision + 1;
  args.emit(
    AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT,
    {
      idempotencyKey: `autonomy-issue-projection:${stateRevision}`,
      stateRevision,
    },
    { delivery: "on-run-success", stepId: args.stepId },
  );
  return true;
}
