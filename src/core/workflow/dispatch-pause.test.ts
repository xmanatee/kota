import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkflowDispatchPause } from "./dispatch-pause.js";
import { ProjectRuntimeStateStore } from "./project-runtime-state.js";
import { RunStateDatabase } from "./run-state-database.js";

describe("workflow dispatch pause", () => {
  let root: string;
  let database: RunStateDatabase;
  let state: ProjectRuntimeStateStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-dispatch-pause-"));
    database = new RunStateDatabase(root);
    database.registerProject({
      id: "project",
      rootPath: root,
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    state = new ProjectRuntimeStateStore(database, "project");
  });

  afterEach(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("persists an operator pause in project state", () => {
    state.setDispatchPaused(true);

    expect(state.getDispatchPaused()).toBe(true);
    expect(
      resolveWorkflowDispatchPause({ operatorPaused: true, runtimePaused: false }),
    ).toMatchObject({ paused: true, kind: "operator", source: "database" });

    state.setDispatchPaused(false);
    expect(state.getDispatchPaused()).toBe(false);
    expect(
      resolveWorkflowDispatchPause({ operatorPaused: false, runtimePaused: false }),
    ).toEqual({ paused: false, kind: "none" });
  });

  it("reports a transient runtime pause without persisting it", () => {
    expect(
      resolveWorkflowDispatchPause({ operatorPaused: false, runtimePaused: true }),
    ).toMatchObject({ paused: true, kind: "runtime", source: "runtime" });
    expect(state.getDispatchPaused()).toBe(false);
  });
});
