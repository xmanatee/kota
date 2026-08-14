import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { digestStateFromCounts } from "./aggregate.js";
import {
  computeDigestSnapshot,
  DAILY_DIGEST_STATE_FILENAME,
  type DigestSnapshot,
} from "./on-demand.js";

export { DAILY_DIGEST_STATE_FILENAME };
export const DAILY_DIGEST_DIGEST_JSON = "digest.json";
export const DAILY_DIGEST_DIGEST_TXT = "digest.txt";

export type DailyDigestBuildOperationInput = {
  projectDir: string;
  runDirPath: string;
  windowEndMs?: number;
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
  writeJsonFileAtomic(
    join(input.projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME),
    digestStateFromCounts(snapshot.currentCounts, snapshot.windowEndMs),
  );
  return snapshot;
}

export const dailyDigestBuildOperation = defineWorkflowBlockingOperation<
  DailyDigestBuildOperationInput,
  DigestSnapshot
>(import.meta.url, "buildDailyDigestInWorker");
