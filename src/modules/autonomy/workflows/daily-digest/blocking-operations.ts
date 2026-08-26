import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { QueueCounts } from "./aggregate.js";
import {
  computeDigestSnapshot,
  type DigestSnapshot,
} from "./on-demand.js";

export const DAILY_DIGEST_DIGEST_JSON = "digest.json";
export const DAILY_DIGEST_DIGEST_TXT = "digest.txt";

export type DailyDigestBuildOperationInput = {
  projectDir: string;
  stateDir: string;
  runDirPath: string;
  windowEndMs?: number;
  previousQueueCounts: QueueCounts | null;
};

export function buildDailyDigestInWorker(
  input: DailyDigestBuildOperationInput,
): DigestSnapshot {
  const snapshot = computeDigestSnapshot(input);
  writeFileSync(
    join(input.runDirPath, DAILY_DIGEST_DIGEST_JSON),
    JSON.stringify(snapshot.data, null, 2),
  );
  writeFileSync(
    join(input.runDirPath, DAILY_DIGEST_DIGEST_TXT),
    `${snapshot.text}\n`,
  );
  return snapshot;
}

export const dailyDigestBuildOperation = defineWorkflowBlockingOperation<
  DailyDigestBuildOperationInput,
  DigestSnapshot
>(import.meta.url, "buildDailyDigestInWorker");
