import { realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  createRunRepositoryAccess,
  type RunRepositoryAccess,
} from "#core/workflow/run-context.js";
import {
  allocationName,
  canonicalRepositoryRoot,
} from "#core/workflow/run-sandbox.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

const RUN_ENV_KEYS = [
  "KOTA_RUN_ID",
  "KOTA_RUN_ATTEMPT",
  "KOTA_DAEMON_EPOCH",
  "KOTA_RUN_STATE_DIR",
] as const;

function positiveInteger(value: string, key: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Native run repository access requires a valid ${key}`);
  }
  return Number(value);
}

export function nativeRunRepositoryAccess(
  workspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
): RunRepositoryAccess | null {
  const values = RUN_ENV_KEYS.map((key) => env[key]?.trim());
  if (values.every((value) => value === undefined || value === "")) return null;
  if (values.some((value) => value === undefined || value === "")) {
    throw new Error("Native run repository access requires a complete run identity");
  }
  const [runId, attemptValue, epochValue, stateDir] = values as [
    string,
    string,
    string,
    string,
  ];
  const attempt = positiveInteger(attemptValue, "KOTA_RUN_ATTEMPT");
  const daemonEpoch = positiveInteger(epochValue, "KOTA_DAEMON_EPOCH");
  const expectedWorkspace = realpathSync(workspaceDir);
  const canonicalRoot = canonicalRepositoryRoot(expectedWorkspace);
  const allocation = allocationName(runId);
  const runtimeRoot = join(canonicalRoot, ".kota", "runtime");
  if (realpathSync(join(runtimeRoot, "worktrees", allocation)) !== expectedWorkspace) {
    throw new Error("Native run repository access requires the reconciled writer workspace");
  }
  const resolvedStateDir = realpathSync(stateDir);
  for (const mutableRoot of [expectedWorkspace, join(runtimeRoot, allocation)]) {
    const child = relative(realpathSync(mutableRoot), resolvedStateDir);
    if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) {
      throw new Error("Native run state database must be outside sandbox mutable roots");
    }
  }
  const store = RunStateDatabase.openReadOnly(resolvedStateDir);
  return createRunRepositoryAccess({
    store,
    runId,
    attempt,
    daemonEpoch,
    workspaceDir: expectedWorkspace,
  });
}
