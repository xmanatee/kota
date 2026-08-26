import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusEvents } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { createTestWorkflowRuntime } from "./testing/runtime-fixture.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

const SOURCE_DEFINITION: RegisteredWorkflowDefinitionInput = {
  name: "source-workflow",
  definitionPath: "src/core/workflow/failure-alert.test.ts",
  repository: "none",
  triggers: [{ event: "manual" }],
  steps: [{ id: "noop", type: "code", run: () => undefined }],
};

function completion(
  status: BusEvents["workflow.completed"]["status"],
  overrides: Partial<BusEvents["workflow.completed"]> = {},
): Omit<BusEvents["workflow.completed"], "projectId"> {
  return {
    workflow: "source-workflow",
    runId: "source-run",
    status,
    triggerEvent: "manual",
    durationMs: 5_000,
    definitionPath: SOURCE_DEFINITION.definitionPath,
    runDir: ".kota/runs/source-run",
    tags: [],
    ...overrides,
  };
}

function createProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-failure-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: projectDir, stdio: "ignore" },
  );
  return projectDir;
}

describe("workflow failure alert", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("runs through durable workflow admission and emits one alert for an idempotent failure publication", async () => {
    const projectDir = createProjectDir();
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "scope-a");
    const journal = new EventJournal(join(projectDir, ".kota", "events"));
    const uninstallJournal = installEventJournal(bus, journal);
    const fixture = createTestWorkflowRuntime({
      bus,
      pbus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [SOURCE_DEFINITION],
    });
    cleanups.push(async () => {
      uninstallJournal();
      await fixture.stop();
      rmSync(projectDir, { recursive: true, force: true });
    });

    const errorDir = join(projectDir, ".kota", "runs", "source-run");
    mkdirSync(errorDir, { recursive: true });
    writeFileSync(join(errorDir, "error.txt"), "Agent exceeded token budget");
    const alerts: BusEvents["workflow.failure.alert"][] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    fixture.runtime.start();
    expect(fixture.runtime.validateDefinitions()).toEqual({ count: 2 });
    const payload = completion("failed");
    pbus.deliverOutbox("workflow.completed", payload, "workflow:source-run:completed");
    await vi.waitFor(() => expect(alerts).toHaveLength(1));

    pbus.deliverOutbox("workflow.completed", payload, "workflow:source-run:completed");
    await vi.waitFor(() => {
      expect(alerts).toHaveLength(1);
      expect(
        fixture.runState
          .listRuns("scope-a")
          .filter((run) => run.workflow === "workflow-failure-alert"),
      ).toHaveLength(1);
    });

    expect(alerts[0]).toMatchObject({
      workflow: "source-workflow",
      runId: "source-run",
      status: "failed",
      durationMs: 5_000,
      errorSummary: "Agent exceeded token budget",
    });
    expect(alerts[0]?.text).toContain("Agent exceeded token budget");
  });

  it("does not admit success or workflows whose failure notification is disabled", async () => {
    const projectDir = createProjectDir();
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "scope-a");
    const fixture = createTestWorkflowRuntime({
      bus,
      pbus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [{ ...SOURCE_DEFINITION, notify: { onFailure: false } }],
    });
    cleanups.push(async () => {
      await fixture.stop();
      rmSync(projectDir, { recursive: true, force: true });
    });
    const alerts: BusEvents["workflow.failure.alert"][] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    fixture.runtime.start();
    pbus.deliverOutbox(
      "workflow.completed",
      completion("failed"),
      "workflow:source-run:failed",
    );
    pbus.deliverOutbox(
      "workflow.completed",
      completion("success", { runId: "successful-run" }),
      "workflow:successful-run:completed",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(alerts).toEqual([]);
    expect(
      fixture.runState
        .listRuns("scope-a")
        .filter((run) => run.workflow === "workflow-failure-alert"),
    ).toEqual([]);
  });
});
