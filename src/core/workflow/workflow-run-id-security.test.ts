import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { RunCoordinator } from "./run-coordinator.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { formatChildRunId, formatRunId } from "./run-io.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-run-id-security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function workflow(name = "security-consumer"): WorkflowDefinition {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition(`test/${name}.ts`, {
        repository: "read",
        name,
        triggers: [{ event: "security.event" }],
        steps: [
          {
            id: "mark",
            type: "emit",
            event: `${name}.done`,
          },
        ],
      }),
    ],
    process.cwd(),
  )[0]!;
}

describe("workflow run id path safety", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let runState: RunStateDatabase;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
    runState = new RunStateDatabase(join(projectDir, ".kota", "state"));
    runState.registerProject({
      id: "scope-test",
      rootPath: projectDir,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  });

  afterEach(() => {
    runState.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not let arbitrary event payload _runId control the queued run id", () => {
    const definitions = [workflow()];
    const daemonEpoch = runState.beginDaemonSession(
      "2026-08-25T10:00:01.000Z",
    ).epoch;
    const coordinator = new RunCoordinator({
      store: runState,
      daemonEpoch,
      concurrency: 1,
      execute: async () => ({ kind: "terminal", state: "succeeded" }),
    });
    coordinator.pauseGlobalAdmission();
    const queue = new WorkflowQueueManager({
      store,
      runState,
      coordinator,
      projectId: "scope-test",
      projectDir,
      getScopeId: () => "scope-test",
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      getDefinitions: () => definitions,
      log: () => {},
    });
    const envelope: BusEnvelope = {
      type: "security.event",
      schemaRef: null,
      payload: {
        _runId: "../outside-run",
        detail: "untrusted event payload",
      },
    };

    enqueueMatchingWorkflows(envelope, definitions, (definition, trigger, run) =>
      queue.enqueue(definition, trigger, run),
    );

    expect(queue.getRuns()).toHaveLength(1);
    const queued = queue.getRuns()[0]!;
    expect(queued.runId).not.toBe("../outside-run");
    expect(queued.runId).toContain("security-consumer");
    expect(queued.trigger.payload).not.toHaveProperty("_runId");
  });

  it("keeps generated run ids path-safe for workflow names with separators", () => {
    const runId = formatRunId("manifest-mod/workflow");

    expect(runId).toContain("manifest-mod-workflow");
    expect(runId).not.toContain("/");
  });

  it("derives one stable child identity for replay of the same trigger step", () => {
    const first = formatChildRunId("parent-run", "trigger-child", "module/child");
    const replay = formatChildRunId("parent-run", "trigger-child", "module/child");
    const otherStep = formatChildRunId("parent-run", "trigger-other", "module/child");

    expect(replay).toBe(first);
    expect(otherStep).not.toBe(first);
    expect(first).toMatch(/^module-child-child-[a-f0-9]{24}$/);
  });

  it("rejects path traversal in store-created payload _runId values", () => {
    expect(() =>
      store.createRun(workflow(), {
        event: "security.event",
        schemaRef: null,
        payload: { _runId: "../outside-run" },
      }),
    ).toThrow("path-safe segment");

    expect(existsSync(join(projectDir, ".kota", "outside-run"))).toBe(false);
  });

  it("rejects path traversal in explicit queued run ids", () => {
    expect(() =>
      store.createRun(
        workflow(),
        { event: "security.event", schemaRef: null, payload: {} },
        "nested/outside-run",
      ),
    ).toThrow("path-safe segment");

    expect(existsSync(join(projectDir, ".kota", "runs", "nested"))).toBe(false);
  });
});
