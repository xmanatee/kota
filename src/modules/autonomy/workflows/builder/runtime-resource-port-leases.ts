import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { BuilderRuntimeResourcePortRange } from "./runtime-resource-ports.js";

const BUILDER_PORT_LEASE_LOCK_WAIT_MS = 30_000;
const BUILDER_PORT_LEASE_LOCK_STALE_MS = 120_000;
const BUILDER_PORT_LEASE_TTL_MS = 24 * 60 * 60 * 1_000;

export type BuilderPortLease = {
  profileId: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  runDirPath: string;
  ports: BuilderRuntimeResourcePortRange;
  createdAt: string;
  updatedAt: string;
};

export type BuilderPortLeaseStore = {
  schemaVersion: 1;
  leases: BuilderPortLease[];
};

type WorkflowStateForPortLeases = {
  activeRuns?: Array<{ runId: string }>;
};

export function readPortLeaseStore(leasePath: string): BuilderPortLeaseStore {
  if (!existsSync(leasePath)) return { schemaVersion: 1, leases: [] };
  const store = JSON.parse(
    readFileSync(leasePath, "utf8"),
  ) as BuilderPortLeaseStore;
  if (store.schemaVersion !== 1 || !Array.isArray(store.leases)) {
    throw new Error(`Invalid builder port lease store: ${leasePath}`);
  }
  return store;
}

export function writePortLeaseStore(
  leasePath: string,
  store: BuilderPortLeaseStore,
): void {
  mkdirSync(dirname(leasePath), { recursive: true });
  const tempPath = `${leasePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tempPath, leasePath);
}

function activeWorkflowRunIds(projectDir: string): Set<string> | null {
  const statePath = join(projectDir, ".kota", "workflow-state.json");
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(
    readFileSync(statePath, "utf8"),
  ) as WorkflowStateForPortLeases;
  return new Set(
    (state.activeRuns ?? [])
      .map((run) => run.runId)
      .filter((runId) => runId.length > 0),
  );
}

export function prunePortLeases(
  projectDir: string,
  leases: BuilderPortLease[],
  nowMs: number,
): BuilderPortLease[] {
  const activeRunIds = activeWorkflowRunIds(projectDir);
  if (activeRunIds !== null) {
    return leases.filter((lease) => activeRunIds.has(lease.runId));
  }
  return leases.filter((lease) => {
    const updatedAtMs = Date.parse(lease.updatedAt);
    return (
      Number.isFinite(updatedAtMs) &&
      nowMs - updatedAtMs <= BUILDER_PORT_LEASE_TTL_MS
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withPortLeaseLock<T>(
  resourceRoot: string,
  runId: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockDir = join(resourceRoot, "builder-port-leases.lock");
  mkdirSync(resourceRoot, { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "owner.json"),
        `${JSON.stringify({ runId, pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      let stale = false;
      try {
        stale =
          Date.now() - lstatSync(lockDir).mtimeMs >
          BUILDER_PORT_LEASE_LOCK_STALE_MS;
      } catch {
        continue;
      }
      if (stale) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > BUILDER_PORT_LEASE_LOCK_WAIT_MS) {
        throw new Error(
          `Timed out waiting for builder port lease lock: ${lockDir}`,
        );
      }
      await sleep(25);
    }
  }
  try {
    return await run();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
