import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import type { WorkflowRuntimeResourcePortRange } from "#core/workflow/run-types.js";
import {
  type BuilderPortLease,
  prunePortLeases,
  readPortLeaseStore,
  withPortLeaseLock,
  writePortLeaseStore,
} from "./runtime-resource-port-leases.js";

const BUILDER_PORT_BASE = 30_000;
const BUILDER_PORT_BLOCK_SIZE = 20;
const BUILDER_PORT_BLOCK_COUNT = 1_000;

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
  portAvailability: "checked" | "skipped-eval-harness-replay";
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

type PortAvailabilityChecker = (port: number) => Promise<boolean>;

const EVAL_HARNESS_REPLAY_ROOT_ENV = "KOTA_EVAL_HARNESS_REPLAY_ROOT";

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

function portsInRange(range: BuilderRuntimeResourcePortRange): number[] {
  const ports: number[] = [];
  for (let port = range.start; port <= range.end; port += 1) {
    ports.push(port);
  }
  return ports;
}

function evalHarnessReplayActive(): boolean {
  return (process.env[EVAL_HARNESS_REPLAY_ROOT_ENV] ?? "").length > 0;
}

async function preflightPorts(
  range: BuilderRuntimeResourcePortRange,
): Promise<Pick<BuilderPortAssignment, "checkedPorts" | "portAvailability">> {
  const ports = portsInRange(range);
  if (evalHarnessReplayActive()) {
    return {
      checkedPorts: ports,
      portAvailability: "skipped-eval-harness-replay",
    };
  }
  for (const port of ports) {
    if (!(await portAvailabilityChecker(port))) {
      throw new Error(
        `Builder runtime resource preflight failed: port ${port} is unavailable`,
      );
    }
  }
  return { checkedPorts: ports, portAvailability: "checked" };
}

function rangesOverlap(
  left: WorkflowRuntimeResourcePortRange,
  right: WorkflowRuntimeResourcePortRange,
): boolean {
  return left.start <= right.end && right.start <= left.end;
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
      const preflight = await preflightPorts(existing.ports);
      const refreshed = leases.map((lease) =>
        lease.profileId === profileId ? { ...lease, updatedAt: now } : lease,
      );
      writePortLeaseStore(leasePath, { schemaVersion: 1, leases: refreshed });
      return {
        ports: existing.ports,
        checkedPorts: preflight.checkedPorts,
        portAvailability: preflight.portAvailability,
        leasePath,
      };
    }

    const ports = nextUnleasedPortRange(
      deterministicBuilderPortBlock(input.taskId, input.runId),
      leases,
    );
    const preflight = await preflightPorts(ports);
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
    return {
      ports,
      checkedPorts: preflight.checkedPorts,
      portAvailability: preflight.portAvailability,
      leasePath,
    };
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
