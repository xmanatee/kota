import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-recover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  return dir;
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
): void {
  const runDir = join(runsDir, id);
  mkdirSync(runDir, { recursive: true });
  const metadata = {
    id,
    workflow,
    definitionPath: `src/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    status,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
}

describe("WorkflowRunStore.recoverInterruptedRuns", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let runsDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
    runsDir = join(projectDir, ".kota", "runs");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns empty array and no-ops when there are no stale runs", () => {
    const recovered = store.recoverInterruptedRuns();
    expect(recovered).toEqual([]);
  });

  it("marks stale running runs as interrupted and writes error.txt", () => {
    writeRunMetadata(runsDir, "run-stale-1", "builder", "running");

    const state = store.readState();
    state.activeRuns = [{ runId: "run-stale-1", workflow: "builder", startedAt: new Date(Date.now() - 60_000).toISOString() }];
    store["writeState"](state);

    const recovered = store.recoverInterruptedRuns();

    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe("run-stale-1");
    expect(recovered[0].status).toBe("interrupted");
    expect(recovered[0].completedAt).toBeDefined();
    expect(recovered[0].durationMs).toBeGreaterThan(0);

    const metadata = JSON.parse(readFileSync(join(runsDir, "run-stale-1", "metadata.json"), "utf-8"));
    expect(metadata.status).toBe("interrupted");

    const errorTxt = readFileSync(join(runsDir, "run-stale-1", "error.txt"), "utf-8");
    expect(errorTxt).toContain("daemon restarted");
  });

  it("does not recover runs that are not in activeRuns (fresh run in same boot)", () => {
    // A run on disk with status "running" but NOT in activeRuns — should not be touched
    writeRunMetadata(runsDir, "run-fresh", "builder", "running");

    // activeRuns is empty — this run was created in this boot, not tracked as stale
    const recovered = store.recoverInterruptedRuns();
    expect(recovered).toEqual([]);

    const metadata = JSON.parse(readFileSync(join(runsDir, "run-fresh", "metadata.json"), "utf-8"));
    expect(metadata.status).toBe("running");
  });

  it("clears activeRuns state after recovery", () => {
    writeRunMetadata(runsDir, "run-stale-2", "explorer", "running");

    const state = store.readState();
    state.activeRuns = [{ runId: "run-stale-2", workflow: "explorer", startedAt: new Date(Date.now() - 60_000).toISOString() }];
    store["writeState"](state);

    store.recoverInterruptedRuns();

    const afterState = store.readState();
    expect(afterState.activeRuns).toEqual([]);
  });

  it("skips stale active run entries whose metadata is already not running", () => {
    writeRunMetadata(runsDir, "run-already-done", "builder", "success");

    const state = store.readState();
    state.activeRuns = [{ runId: "run-already-done", workflow: "builder", startedAt: new Date(Date.now() - 60_000).toISOString() }];
    store["writeState"](state);

    const recovered = store.recoverInterruptedRuns();
    expect(recovered).toEqual([]);

    // error.txt should not be written
    expect(existsSync(join(runsDir, "run-already-done", "error.txt"))).toBe(false);
  });

  it("updates workflow last status to interrupted in state", () => {
    writeRunMetadata(runsDir, "run-stale-3", "builder", "running");

    const state = store.readState();
    state.activeRuns = [{ runId: "run-stale-3", workflow: "builder", startedAt: new Date(Date.now() - 60_000).toISOString() }];
    store["writeState"](state);

    store.recoverInterruptedRuns();

    const afterState = store.readState();
    expect(afterState.workflows["builder"]?.lastStatus).toBe("interrupted");
  });

  it("creates new runs only under .kota/runs", () => {
    const workflow: WorkflowDefinition = {
      name: "builder",
      definitionPath: "src/workflows/builder/workflow.ts",
      description: "test",
      enabled: true,
      triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
      steps: [],
    };

    const handle = store.createRun(workflow, { event: "runtime.idle", payload: {} });

    expect(handle.metadata.runDir).toBe(`.kota/runs/${handle.metadata.id}`);
    expect(existsSync(join(projectDir, handle.metadata.runDir))).toBe(true);
    expect(existsSync(join(projectDir, "runs", handle.metadata.id))).toBe(false);
  });
});
