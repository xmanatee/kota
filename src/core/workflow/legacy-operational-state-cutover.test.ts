import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  disposeLegacyOperationalState,
  LEGACY_OPERATIONAL_CUTOVER_STATE_KEY,
} from "./legacy-operational-state-cutover.js";
import { RunStateDatabase } from "./run-state-database.js";
import { createTestWorkflowRuntime } from "./testing/runtime-fixture.js";

function obsoletePaths(projectDir: string): string[] {
  const root = join(projectDir, ".kota");
  return [
    join(root, "workflow-state.json"),
    join(root, "scope-improvement", "state.json"),
    join(root, "scope-improvement", "evidence-ready.json"),
    join(root, "task-claims", "active", "task-a.json"),
    join(root, "runtime-resources", "builder-port-leases.json"),
    join(root, "dispatch-paused"),
  ];
}

function write(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "obsolete\n", "utf8");
}

describe("legacy operational state disposal", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(): {
    projectDir: string;
    projectId: string;
    runState: RunStateDatabase;
  } {
    const root = join(
      tmpdir(),
      `kota-legacy-disposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    roots.push(root);
    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });
    const projectId = deriveDirectoryScopeId(projectDir);
    const runState = new RunStateDatabase(join(root, "daemon-state"));
    runState.registerProject({
      id: projectId,
      rootPath: projectDir,
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    return { projectDir, projectId, runState };
  }

  it("deletes only known obsolete paths and records one completed marker", () => {
    const { projectDir, projectId, runState } = fixture();
    const paths = obsoletePaths(projectDir);
    for (const path of paths) write(path);
    const preserved = join(projectDir, ".kota", "runs", "evidence.json");
    write(preserved);
    const timestamps = [
      "2026-08-26T00:00:01.000Z",
      "2026-08-26T00:00:02.000Z",
    ];

    disposeLegacyOperationalState({
      projectDir,
      projectId,
      runState,
      now: () => timestamps.shift()!,
    });

    expect(paths.every((path) => !existsSync(path))).toBe(true);
    expect(existsSync(preserved)).toBe(true);
    expect(runState.listRuns(projectId)).toEqual([]);
    expect(
      runState.readProjectStateValue(projectId, LEGACY_OPERATIONAL_CUTOVER_STATE_KEY),
    ).toEqual({
      revision: 2,
      value: {
        status: "complete",
        preparedAt: "2026-08-26T00:00:01.000Z",
        completedAt: "2026-08-26T00:00:02.000Z",
      },
    });

    disposeLegacyOperationalState({ projectDir, projectId, runState });
    expect(
      runState.readProjectStateValue(projectId, LEGACY_OPERATIONAL_CUTOVER_STATE_KEY),
    ).toMatchObject({ revision: 2 });
    runState.close();
  });

  it("finishes a prepared disposal after a crash", () => {
    const { projectDir, projectId, runState } = fixture();
    const path = obsoletePaths(projectDir)[0]!;
    write(path);
    runState.compareAndSetProjectStateValue({
      projectId,
      key: LEGACY_OPERATIONAL_CUTOVER_STATE_KEY,
      expectedRevision: 0,
      value: {
        status: "prepared",
        preparedAt: "2026-08-26T00:00:01.000Z",
      },
      updatedAt: "2026-08-26T00:00:01.000Z",
    });

    disposeLegacyOperationalState({
      projectDir,
      projectId,
      runState,
      now: () => "2026-08-26T00:00:02.000Z",
    });

    expect(existsSync(path)).toBe(false);
    expect(
      runState.readProjectStateValue(projectId, LEGACY_OPERATIONAL_CUTOVER_STATE_KEY),
    ).toMatchObject({ revision: 2, value: { status: "complete" } });
    runState.close();
  });

  it("rejects obsolete state that reappears after disposal", () => {
    const { projectDir, projectId, runState } = fixture();
    disposeLegacyOperationalState({ projectDir, projectId, runState });
    write(obsoletePaths(projectDir)[0]!);

    expect(() =>
      disposeLegacyOperationalState({ projectDir, projectId, runState })
    ).toThrow(/obsolete operational state reappeared after disposal/i);
    runState.close();
  });

  it("does not dispose project state when a standalone runtime starts", async () => {
    const { projectDir, runState } = fixture();
    runState.close();
    const path = obsoletePaths(projectDir)[0]!;
    write(path);
    const runtime = createTestWorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });

    runtime.runtime.start("paused");

    expect(existsSync(path)).toBe(true);
    await runtime.stop();
  });
});
