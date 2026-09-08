import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type OwnerDecisionRecord,
  OwnerDecisionRecordRepository,
  OwnerDecisionRecordStorage,
} from "#core/daemon/owner-decision-store.js";

/** Reporting reads the scoped repository; only OwnerDecisionStore can authorize an action. */
export function observeOwnerDecisions(stateDir: string, scopeId: string): OwnerDecisionRecord[] {
  const directory = join(stateDir, "owner-decisions");
  if (!existsSync(directory)) return [];
  const repository = new OwnerDecisionRecordRepository(
    new OwnerDecisionRecordStorage(directory), scopeId,
  );
  return repository.list().map(({ item }) => item);
}
