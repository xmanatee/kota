import { existsSync } from "node:fs";
import { join } from "node:path";
import { AnchoredRecordStorage } from "#core/daemon/anchored-record-storage.js";
import {
  type OwnerDecisionRecord,
  OwnerDecisionRecordRepository,
} from "#core/daemon/owner-decision-store.js";

/** Reporting reads the scoped repository; only OwnerDecisionStore can authorize an action. */
export function observeOwnerDecisions(stateDir: string, scopeId: string): OwnerDecisionRecord[] {
  const directory = join(stateDir, "owner-decisions");
  if (!existsSync(directory)) return [];
  const repository = new OwnerDecisionRecordRepository(
    new AnchoredRecordStorage(directory), scopeId,
  );
  return repository.list().map(({ item }) => item);
}
