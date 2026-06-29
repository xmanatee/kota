import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { WorkflowRuntimeResourcePortRange } from "#core/workflow/run-types.js";

const BUILDER_PORT_BASE = 30_000;
const BUILDER_PORT_BLOCK_SIZE = 20;
const BUILDER_PORT_BLOCK_COUNT = 1_000;
const BUILDER_PORT_LEASE_LOCK_WAIT_MS = 30_000;
const BUILDER_PORT_LEASE_LOCK_STALE_MS = 120_000;
const BUILDER_PORT_LEASE_TTL_MS = 24 * 60 * 60 * 1_000;

export type BuilderRuntimeResourcePortRange =
  WorkflowRuntimeResourcePortRange & {
    size: number;
  };

export type BuilderPortResourceInput = {
  projectDir: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  runDirPath: string;
};

export type BuilderPortAssignment = {
  ports: BuilderRuntimeResourcePortRange;
  checkedPorts: number[];
  leasePath: string;
};

export type ReleaseBuilderPortRangeInput = {
  projectDir: string;
  runId: string;
  profileId: string;
};

export type ReleaseBuilderPortRangeResult = {
  leasePath: string;
  released: boolean;
  releasedProfileIds: string[];
  remainingLeaseCount: number;
};

type BuilderPortLease = {
  profileId: string;
  taskId: string;
  runId: string;
  workspaceDir: string;
  runDirPath: string;
  ports: BuilderRuntimeResourcePortRange;
  createdAt: string;
  updatedAt: string;
};

type BuilderPortLeaseStore = {
  schemaVersion: 1;
  leases: BuilderPortLease[];
};

type WorkflowStateForPortLeases = {
  activeRuns?: Array<{ runId: string }>;
};

type PortAvailabilityChecker = (port: number) => Promise<boolean>;

function deterministicBuilderPortBlock(taskId: string, runId: string): number {
  const digest = createHash("sha256")
    .update(`${taskId}:${runId}`)
    .digest();
  return digest.readUInt32BE(0) % BUILDER_PORT_BLOCK_COUNT;
}

function portRangeForBlock(block: number): BuilderRuntimeResourcePortRange {
  const start = BUILDER_PORT_BASE + block * BUILDER_PORT_BLOCK_SIZE;
  return {
    start,
    end: start + BUILDER_PORT_BLOCK_SIZE - 1,
    size: BUILDER_PORT_BLOCK_SIZE,
  };
}

export function deterministicBuilderPortRange(
  taskId: string,
  runId: string,
): BuilderRuntimeResourcePortRange {
  return portRangeForBlock(deterministicBuilderPortBlock(taskId, runId));
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

let portAvailabilityChecker: PortAvailabilityChecker = portAvailable;

export function setBuilderPortAvailabilityCheckerForTest(
  checker: PortAvailabilityChecker,
): () => void {
  const previous = portAvailabilityChecker;
  portAvailabilityChecker = checker;
  return () => {
    portAvailabilityChecker = previous;
  };
}

async function preflightPorts(
  range: BuilderRuntimeResourcePortRange,
): Promise<number[]> {
  const ports: number[] = [];
  for (let port = range.start; port <= range.end; port += 1) {
    if (!(await portAvailabilityChecker(port))) {
      throw new Error(
        `Builder runtime resource preflight failed: port ${port} is unavailable`,
      );
    }
    ports.push(port);
  }
  return ports;
}

function rangesOverlap(
  left: WorkflowRuntimeResourcePortRange,
  right: WorkflowRuntimeResourcePortRange,
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function readPortLeaseStore(leasePath: string): BuilderPortLeaseStore {
  if (!existsSync(leasePath)) return { schemaVersion: 1, leases: [] };
  const store = JSON.parse(
    readFileSync(leasePath, "utf8"),
  ) as BuilderPortLeaseStore;
  if (store.schemaVersion !== 1 || !Array.isArray(store.leases)) {
    throw new Error(`Invalid builder port lease store: ${leasePath}`);
  }
  return store;
}

function writePortLeaseStore(
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

function prunePortLeases(
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

function nextUnleasedPortRange(
  preferredBlock: number,
  leases: BuilderPortLease[],
): BuilderRuntimeResourcePortRange {
  for (let offset = 0; offset < BUILDER_PORT_BLOCK_COUNT; offset += 1) {
    const block = (preferredBlock + offset) % BUILDER_PORT_BLOCK_COUNT;
    const candidate = portRangeForBlock(block);
    if (!leases.some((lease) => rangesOverlap(lease.ports, candidate))) {
      return candidate;
    }
  }
  throw new Error(
    "Builder runtime resource preflight failed: no unleased builder port ranges remain",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPortLeaseLock<T>(
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

export async function assignBuilderPortRange(
  input: BuilderPortResourceInput,
  profileId: string,
): Promise<BuilderPortAssignment> {
  const resourceRoot = join(input.projectDir, ".kota", "runtime-resources");
  const leasePath = join(resourceRoot, "builder-port-leases.json");
  return withPortLeaseLock(resourceRoot, input.runId, async () => {
    const now = new Date().toISOString();
    const store = readPortLeaseStore(leasePath);
    const leases = prunePortLeases(input.projectDir, store.leases, Date.now());
    const existing = leases.find((lease) => lease.profileId === profileId);
    if (existing !== undefined) {
      const checkedPorts = await preflightPorts(existing.ports);
      const refreshed = leases.map((lease) =>
        lease.profileId === profileId ? { ...lease, updatedAt: now } : lease,
      );
      writePortLeaseStore(leasePath, { schemaVersion: 1, leases: refreshed });
      return {
        ports: existing.ports,
        checkedPorts,
        leasePath,
      };
    }

    const ports = nextUnleasedPortRange(
      deterministicBuilderPortBlock(input.taskId, input.runId),
      leases,
    );
    const checkedPorts = await preflightPorts(ports);
    writePortLeaseStore(leasePath, {
      schemaVersion: 1,
      leases: [
        ...leases,
        {
          profileId,
          taskId: input.taskId,
          runId: input.runId,
          workspaceDir: input.workspaceDir,
          runDirPath: input.runDirPath,
          ports,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    return { ports, checkedPorts, leasePath };
  });
}

export async function releaseBuilderPortRange(
  input: ReleaseBuilderPortRangeInput,
): Promise<ReleaseBuilderPortRangeResult> {
  const resourceRoot = join(input.projectDir, ".kota", "runtime-resources");
  const leasePath = join(resourceRoot, "builder-port-leases.json");
  return withPortLeaseLock(resourceRoot, input.runId, async () => {
    const store = readPortLeaseStore(leasePath);
    const releasedProfileIds = store.leases
      .filter((lease) => lease.profileId === input.profileId)
      .map((lease) => lease.profileId);
    if (releasedProfileIds.length === 0) {
      return {
        leasePath,
        released: false,
        releasedProfileIds,
        remainingLeaseCount: store.leases.length,
      };
    }

    const leases = store.leases.filter(
      (lease) => lease.profileId !== input.profileId,
    );
    writePortLeaseStore(leasePath, { schemaVersion: 1, leases });
    return {
      leasePath,
      released: true,
      releasedProfileIds,
      remainingLeaseCount: leases.length,
    };
  });
}
