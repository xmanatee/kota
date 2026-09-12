import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type OwnedProcessIdentity,
  type ProcessIdentity,
  type ProcessOutcome,
  ProcessSupervisor,
} from "#core/execution/process-supervisor.js";
import { recoverInterruptedRuns } from "./run-restart-recovery.js";
import { RunStateDatabase } from "./run-state-database.js";

const roots: string[] = [];
const stores: RunStateDatabase[] = [];
const activeProcesses: Array<{
  supervisor: ProcessSupervisor;
  completion: Promise<ProcessOutcome>;
}> = [];

function createStore(): RunStateDatabase {
  const root = mkdtempSync(join(tmpdir(), "kota-restart-recovery-"));
  roots.push(root);
  const store = new RunStateDatabase(join(root, "state"));
  stores.push(store);
  store.registerScope({
    id: "scope-a",
    rootPath: join(root, "scope-a"),
    createdAt: "2026-08-25T09:00:00.000Z",
  });
  return store;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out waiting for process tree")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function startProcessTree(): Promise<{
  identity: ProcessIdentity;
  childPid: number;
  completion: Promise<ProcessOutcome>;
}> {
  const childScript =
    'process.on("SIGTERM", () => process.exit(0)); process.stdout.write(`child:${process.pid}\\n`); setInterval(() => {}, 1000);';
  const parentScript =
    'const { spawn } = require("node:child_process");' +
    `spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: ["ignore", "inherit", "inherit"] });` +
    'process.on("SIGTERM", () => process.exit(0)); process.stdout.write("parent-ready\\n"); setInterval(() => {}, 1000);';
  let output = "";
  let identity: ProcessIdentity | undefined;
  let childPid: number | undefined;
  let markReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const supervisor = new ProcessSupervisor({
    command: process.execPath,
    args: ["-e", parentScript],
    cwd: tmpdir(),
    env: {},
    captureLimitBytesPerStream: 4_096,
    terminationGraceMs: 100,
    onSpawn: (spawnedIdentity) => {
      identity = spawnedIdentity;
    },
    onOutput: ({ stream, data }) => {
      if (stream !== "stdout") return;
      output += data;
      childPid = Number(/child:(\d+)/.exec(output)?.[1]) || childPid;
      if (identity !== undefined && childPid !== undefined && output.includes("parent-ready")) {
        markReady?.();
      }
    },
  });
  const completion = supervisor.run();
  activeProcesses.push({ supervisor, completion });
  await withTimeout(
    Promise.race([
      ready,
      completion.then((outcome) => {
        throw new Error(`process tree exited before recovery: ${outcome.status}`);
      }),
    ]),
    2_000,
  );
  if (identity === undefined || childPid === undefined) {
    throw new Error("process tree did not expose its durable identities");
  }
  return { identity, childPid, completion };
}

function prepareInterruptedRun(
  store: RunStateDatabase,
  persistedIdentity: OwnedProcessIdentity,
  ...additionalIdentities: OwnedProcessIdentity[]
): {
  daemonEpoch: number;
  attempts: ReturnType<RunStateDatabase["beginDaemonSession"]>["recovered"];
} {
  const first = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
  store.admitRun({
    id: "run-a",
    scopeId: "scope-a",
    workflow: "shared-automation",
    repository: "write",
    trigger: { event: "test.requested", schemaRef: null, payload: {} },
    resources: ["task:task-a"],
    admittedAt: "2026-08-25T10:00:01.000Z",
  });
  store.startRun("run-a", first.epoch, "2026-08-25T10:00:02.000Z");
  expect(
    store.tryAcquireResource({
      runId: "run-a",
      resourceKey: "repo:default:integration",
      lifetime: "attempt",
      epoch: first.epoch,
      acquiredAt: "2026-08-25T10:00:03.000Z",
    }),
  ).toBe(true);
  for (const identity of [persistedIdentity, ...additionalIdentities]) {
    store.registerAttemptProcess({
      runId: "run-a",
      epoch: first.epoch,
      processKey: "kind" in identity ? `resource:${identity.key}` : `${identity.pid}:${identity.osStartToken}`,
      identity: { ...identity },
      registeredAt: "2026-08-25T10:00:04.000Z",
    });
  }
  const second = store.beginDaemonSession("2026-08-25T10:01:00.000Z");
  return { daemonEpoch: second.epoch, attempts: second.recovered };
}

function expectProcessGone(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
}

afterEach(async () => {
  for (const active of activeProcesses.splice(0)) {
    const identity = active.supervisor.identity;
    if (identity !== undefined) {
      await ProcessSupervisor.terminateOwnedProcess(identity, 50);
    }
    await withTimeout(active.completion, 2_000).catch(() => undefined);
  }
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe.skipIf(process.platform === "win32")("recoverInterruptedRuns", () => {
  test("terminates the verified process tree before requeueing the run", async () => {
    const store = createStore();
    const processTree = await startProcessTree();
    const recovery = prepareInterruptedRun(store, processTree.identity);

    const blocked = await recoverInterruptedRuns({
      store,
      daemonEpoch: recovery.daemonEpoch,
      attempts: recovery.attempts,
      terminationGraceMs: 100,
      now: () => {
        expect(ProcessSupervisor.verifyOwnedProcess(processTree.identity).status).toBe(
          "not-running",
        );
        expectProcessGone(processTree.childPid);
        return "2026-08-25T10:01:01.000Z";
      },
    });
    await processTree.completion;

    expect(blocked).toEqual([]);
    expect(store.getRun("run-a")).toMatchObject({
      state: "queued",
      resources: ["task:task-a"],
      processes: [],
    });
  });

  test("keeps recovery fencing until a later daemon confirms the process is gone", async () => {
    const store = createStore();
    const processTree = await startProcessTree();
    const staleIdentity = {
      ...processTree.identity,
      osStartToken: `${processTree.identity.osStartToken}-stale`,
    };
    const recovery = prepareInterruptedRun(store, staleIdentity);

    const blocked = await recoverInterruptedRuns({
      store,
      daemonEpoch: recovery.daemonEpoch,
      attempts: recovery.attempts,
      terminationGraceMs: 50,
    });

    expect(blocked).toEqual([
      {
        runId: "run-a",
        reason: "a persisted process PID now belongs to a different process",
      },
    ]);
    expect(store.getRun("run-a")).toMatchObject({
      state: "needs_attention",
      resources: ["repo:default:integration", "task:task-a"],
      processes: [{ ...staleIdentity }],
      wait: { reason: "daemon-restart-process-recovery" },
    });
    expect(ProcessSupervisor.verifyOwnedProcess(processTree.identity).status).toBe("owned");
    expect(() => process.kill(processTree.childPid, 0)).not.toThrow();

    await ProcessSupervisor.terminateOwnedProcess(processTree.identity, 50);
    await processTree.completion;
    const nextSession = store.beginDaemonSession("2026-08-25T10:02:00.000Z");
    expect(nextSession.recovered).toEqual([
      expect.objectContaining({ runId: "run-a", processes: [{ ...staleIdentity }] }),
    ]);
    expect(await recoverInterruptedRuns({
      store,
      daemonEpoch: nextSession.epoch,
      attempts: nextSession.recovered,
      terminationGraceMs: 50,
    })).toEqual([]);
    expect(store.getRun("run-a")).toMatchObject({
      state: "queued",
      resources: ["task:task-a"],
      processes: [],
    });
  });
});

test("restart removes a resource registered before its client launch and preserves ownership if cleanup is unavailable", async () => {
  const store = createStore();
  const directory = join(roots.at(-1)!, "temporary-login");
  mkdirSync(directory);
  const { daemonEpoch, attempts } = prepareInterruptedRun(store, {
    kind: "resource", key: randomUUID(), cleanup: { kind: "directory", path: directory },
  });
  expect(await recoverInterruptedRuns({ store, daemonEpoch, attempts })).toEqual([]);
  expect(existsSync(directory)).toBe(false);
  expect(store.getRun("run-a")?.state).toBe("queued");

  const other = createStore();
  const interrupted = prepareInterruptedRun(other, {
    kind: "resource", key: randomUUID(), cleanup: { kind: "command", command: "docker", args: ["rm", "--force", "owned-container"], absentMessage: "No such container" },
  });
  const launch = vi.spyOn(ProcessSupervisor.prototype, "run").mockResolvedValue({
    status: "spawn-failed", attemptedAt: "2026-09-12T00:00:00Z", commandHash: "cleanup",
    error: { code: "ECONNREFUSED", message: "Container server unavailable" },
  });
  try {
    expect(await recoverInterruptedRuns({ store: other, ...interrupted })).toMatchObject([{ runId: "run-a", reason: expect.stringContaining("Container server unavailable") }]);
    expect(other.getRun("run-a")?.state).not.toBe("queued");
    launch.mockResolvedValue({ status: "completed", identity: { pid: 1, processGroupId: 1, osStartToken: "test", observedCommandHash: "test" }, exitCode: 1, signal: null,
      stdout: { text: "", totalBytes: 0, truncated: false }, stderr: { text: "No such container: owned-container", totalBytes: 34, truncated: false } });
    expect(await recoverInterruptedRuns({ store: other, ...interrupted })).toEqual([]);
    expect(other.getRun("run-a")?.state).toBe("queued");
  } finally { launch.mockRestore(); }
});


test.each(["identity-mismatch", "still-running", "termination-error", "resource-error"] as const)(
  "restart attempts independent resource cleanup after %s and retains unresolved ownership",
  async (failure) => {
    const store = createStore();
    const directory = join(roots.at(-1)!, "temporary-login");
    mkdirSync(directory);
    const identity: ProcessIdentity = { pid: 321, processGroupId: 321, osStartToken: "previous-attempt", observedCommandHash: "client" };
    const recovery = prepareInterruptedRun(store, identity,
      { kind: "resource", key: "00000000-0000-4000-8000-000000000001", cleanup: { kind: "command", command: "docker", args: ["rm", "--force", "owned-evaluation"] } },
      { kind: "resource", key: "00000000-0000-4000-8000-000000000002", cleanup: { kind: "directory", path: directory } },
    );
    const completed: ProcessOutcome = { status: "completed", identity, exitCode: 0, signal: null,
      stdout: { text: "", totalBytes: 0, truncated: false }, stderr: { text: "", totalBytes: 0, truncated: false } };
    const launch = vi.spyOn(ProcessSupervisor.prototype, "run").mockResolvedValue(failure === "resource-error"
      ? { status: "spawn-failed", attemptedAt: "2026-09-12T00:00:00Z", commandHash: "cleanup", error: { code: "ECONNREFUSED", message: "Container server unavailable" } }
      : completed);
    try {
      const blocked = await recoverInterruptedRuns({ store, ...recovery, terminate: async () => {
        if (failure === "termination-error") throw new Error("Process inspection failed");
        if (failure === "identity-mismatch") return { status: "identity-mismatch", observed: { ...identity, osStartToken: "reused-pid" }, escalated: false };
        if (failure === "still-running") return { status: "still-running", escalated: true };
        return { status: "not-running", escalated: false };
      } });
      expect(blocked).toHaveLength(1);
      expect(launch).toHaveBeenCalledTimes(1);
      expect(existsSync(directory)).toBe(false);
      expect(store.getRun("run-a")).toMatchObject({ state: "needs_attention", processes: recovery.attempts[0]!.processes,
        resources: ["repo:default:integration", "task:task-a"], wait: { reason: "daemon-restart-process-recovery" } });
      launch.mockResolvedValue(completed);
      const next = store.beginDaemonSession("2026-08-25T10:02:00.000Z");
      expect(await recoverInterruptedRuns({ store, daemonEpoch: next.epoch, attempts: next.recovered,
        terminate: async () => ({ status: "not-running", escalated: false }) })).toEqual([]);
      expect(store.getRun("run-a")).toMatchObject({ state: "queued", processes: [] });
    } finally { launch.mockRestore(); }
  },
);


test("restart confirms resource removal after its creating client has stopped", async () => {
  const store = createStore();
  const directory = join(roots.at(-1)!, "late-resource");
  const identity: ProcessIdentity = { pid: 321, processGroupId: 321, osStartToken: "previous-attempt", observedCommandHash: "client" };
  // Resources are registered before their client launches, matching production.
  const recovery = prepareInterruptedRun(store,
    { kind: "resource", key: "00000000-0000-4000-8000-000000000001", cleanup: { kind: "directory", path: directory } },
    identity,
  );
  expect(await recoverInterruptedRuns({ store, ...recovery, terminate: async () => {
    mkdirSync(directory, { recursive: true });
    return { status: "terminated", escalated: false };
  } })).toEqual([]);
  expect(existsSync(directory)).toBe(false);
  expect(store.getRun("run-a")).toMatchObject({ state: "queued", processes: [] });
});
