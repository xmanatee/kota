import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RunResourceAllocator } from "./run-resources.js";
import type { RunSandbox } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { StoredRun } from "./run-state-types.js";

const roots: string[] = [];
const stores: RunStateDatabase[] = [];

function setupRun(id: string, store?: RunStateDatabase): {
  store: RunStateDatabase;
  epoch: number;
  run: StoredRun;
  sandbox: RunSandbox;
} {
  const root = store === undefined
    ? mkdtempSync(join(tmpdir(), "kota-run-resources-"))
    : join(roots[0]!, id);
  if (store === undefined) roots.push(root);
  mkdirSync(root, { recursive: true });
  const state = store ?? new RunStateDatabase(join(root, "state"));
  if (store === undefined) {
    stores.push(state);
    state.registerScope({
      id: "scope",
      rootPath: join(root, "project"),
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  }
  const epoch = state.getEpoch() || state.beginDaemonSession("2026-08-25T10:00:00.000Z").epoch;
  state.admitRun({
    id,
    scopeId: "scope",
    workflow: "workflow",
    repository: "none",
    trigger: { event: "test", schemaRef: null, payload: {} },
    resources: [],
    admittedAt: `2026-08-25T10:00:0${id.length}.000Z`,
  });
  state.startRun(id, epoch, "2026-08-25T10:01:00.000Z");
  const sandboxRoot = join(root, "runtime", id);
  const sandbox: RunSandbox = {
    runId: id,
    repository: "none",
    rootDir: sandboxRoot,
    workspaceDir: join(sandboxRoot, "workspace"),
    tempDir: join(sandboxRoot, "tmp"),
    artifactDir: join(sandboxRoot, "artifacts"),
  };
  for (const path of [
    sandbox.rootDir,
    sandbox.workspaceDir,
    sandbox.tempDir,
    sandbox.artifactDir,
  ]) mkdirSync(path, { recursive: true });
  return { store: state, epoch, run: state.getRun(id)!, sandbox };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function allocator(store: RunStateDatabase, unavailable: number[] = []) {
  return new RunResourceAllocator(store, {
    portStart: 41_000,
    portEnd: 41_007,
    portRangeSize: 2,
    isPortAvailable: async (port) => !unavailable.includes(port),
    now: () => "2026-08-25T10:02:00.000Z",
  });
}

describe("RunResourceAllocator", () => {
  test("concurrent attempts receive disjoint fixed-size ranges", async () => {
    const first = setupRun("run-a");
    const second = setupRun("run-b", first.store);

    const [left, right] = await Promise.all([
      allocator(first.store).allocate(first.run, first.sandbox, first.epoch),
      allocator(first.store).allocate(second.run, second.sandbox, second.epoch),
    ]);

    expect(left.ports.values).toHaveLength(2);
    expect(right.ports.values).toHaveLength(2);
    expect(left.ports.values.some((port) => right.ports.values.includes(port))).toBe(false);
  });

  test("releases partial claims before scanning the next range", async () => {
    const fixture = setupRun("run-a");

    const profile = await allocator(fixture.store, [41_001]).allocate(
      fixture.run,
      fixture.sandbox,
      fixture.epoch,
    );

    expect(profile.ports.values).toEqual([41_002, 41_003]);
    expect(fixture.store.getRun(fixture.run.id)?.resources).toEqual([
      "global:port:41002",
      "global:port:41003",
    ]);
  });

  test("derives an immutable environment only from the run sandbox", async () => {
    const fixture = setupRun("run-a");

    const profile = await allocator(fixture.store).allocate(
      fixture.run,
      fixture.sandbox,
      fixture.epoch,
    );

    expect(profile).toMatchObject({
      workspaceDir: fixture.sandbox.workspaceDir,
      runDir: fixture.sandbox.rootDir,
      tempDir: fixture.sandbox.tempDir,
      artifactDir: fixture.sandbox.artifactDir,
      agentDir: join(fixture.sandbox.rootDir, "agent"),
      packageCacheDir: join(fixture.sandbox.tempDir, "package-cache"),
    });
    expect(profile.env).toMatchObject({
      TMPDIR: fixture.sandbox.tempDir,
      KOTA_SCOPE_ROOT: fixture.sandbox.workspaceDir,
      KOTA_WORKSPACE_DIR: fixture.sandbox.workspaceDir,
      KOTA_RUN_DIR: join(fixture.sandbox.rootDir, "agent"),
      KOTA_RUN_ARTIFACT_DIR: fixture.sandbox.artifactDir,
      KOTA_PORT_BASE: "41000",
      KOTA_PORT_RANGE: "2",
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.env)).toBe(true);
    expect(Object.isFrozen(profile.ports.values)).toBe(true);
  });

  test("reports exhaustion without leaking attempt resources", async () => {
    const fixture = setupRun("run-a");

    await expect(
      allocator(fixture.store, [41_001, 41_003, 41_005, 41_007]).allocate(
        fixture.run,
        fixture.sandbox,
        fixture.epoch,
      ),
    ).rejects.toThrow("No run-owned local port range is available");
    expect(fixture.store.getRun(fixture.run.id)?.resources).toEqual([]);
  });
});
