import { isDeepStrictEqual } from "node:util";
import type { TransactionalRunState } from "#core/workflow/run-context.js";
import type { AutonomyIssueProjection } from "./autonomy-issue-projection.js";

export function stageAutonomyIssueProjection(args: {
  state: TransactionalRunState;
  key: string;
  revision: number;
  current: AutonomyIssueProjection;
  next: AutonomyIssueProjection;
}): boolean {
  if (isDeepStrictEqual(args.current, args.next)) return false;
  args.state.compareAndSet(args.key, args.revision, args.next);
  return true;
}
