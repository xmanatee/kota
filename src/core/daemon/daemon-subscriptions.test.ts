import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BusEvents } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";

function makeProjectDir(name: string): string {
  const path = join(
    tmpdir(),
    `kota-daemon-subscriptions-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(path, { recursive: true });
  return path;
}

function makeWorkflowCompletedPayload(
  scopeName: string,
): Omit<BusEvents["workflow.completed"], "projectId" | "scopeId"> {
  return {
    workflow: `builder-${scopeName}`,
    runId: `run-${scopeName}`,
    status: "failed",
    triggerEvent: "runtime.idle",
    durationMs: 1000,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    runDir: `.kota/runs/run-${scopeName}`,
    tags: [],
  };
}

describe("subscribeDaemon", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("subscribes workflow failure alerts for every configured scope", () => {
    const bus = new EventBus();
    const pbusA = new ProjectScopedEventBus(bus, "scope-a");
    const pbusB = new ProjectScopedEventBus(bus, "scope-b");
    const projectDirA = makeProjectDir("a");
    const projectDirB = makeProjectDir("b");
    projectDirs.push(projectDirA, projectDirB);
    const alerts: Array<BusEvents["workflow.failure.alert"] & { scopeId: string }> = [];
    bus.on("workflow.failure.alert", (payload) =>
      alerts.push(payload as BusEvents["workflow.failure.alert"] & { scopeId: string }),
    );

    const unsubscribe = subscribeDaemon({
      bus,
      failureAlertScopes: [
        { pbus: pbusA, projectDir: projectDirA },
        { pbus: pbusB, projectDir: projectDirB },
      ],
      pollIntervalMs: 60_000,
      onDueItems: () => {},
      onWorkflowCompleted: () => {},
      onRestartRequested: () => {},
      onLog: () => {},
    });

    pbusA.emit("workflow.completed", makeWorkflowCompletedPayload("a"));
    pbusB.emit("workflow.completed", makeWorkflowCompletedPayload("b"));
    unsubscribe();

    expect(alerts.map((alert) => alert.scopeId).sort()).toEqual([
      "scope-a",
      "scope-b",
    ]);
    expect(alerts.map((alert) => alert.projectId).sort()).toEqual([
      "scope-a",
      "scope-b",
    ]);
    expect(alerts.map((alert) => alert.workflow).sort()).toEqual([
      "builder-a",
      "builder-b",
    ]);
  });
});
