import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import dailyDigestWorkflow, {
  DAILY_DIGEST_DIGEST_JSON,
  DAILY_DIGEST_DIGEST_TXT,
  DAILY_DIGEST_EVENT,
  DAILY_DIGEST_STATE_FILENAME,
} from "./workflow.js";

vi.mock("#core/daemon/owner-question-queue.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("#core/daemon/owner-question-queue.js")
    >("#core/daemon/owner-question-queue.js");
  let queue: InstanceType<typeof actual.OwnerQuestionQueue> | null = null;
  return {
    ...actual,
    getOwnerQuestionQueue: (dir?: string) => {
      if (!queue) {
        queue = new actual.OwnerQuestionQueue(
          dir ?? join(process.cwd(), ".kota", "owner-questions"),
        );
      }
      return queue;
    },
    resetOwnerQuestionQueue: () => {
      queue = null;
    },
  };
});

describe("daily-digest workflow definition", () => {
  it("registers without errors and exposes one cron-scheduled code step", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/daily-digest/workflow.ts",
      dailyDigestWorkflow,
    );
    expect(registered.name).toBe("daily-digest");
    expect(registered.steps).toHaveLength(1);
    expect(registered.steps[0].id).toBe("build-digest");
    expect(registered.steps[0].type).toBe("code");
    expect(registered.triggers).toHaveLength(1);
    expect(registered.triggers[0].schedule).toBe("0 8 * * *");
  });

  it("has no runtime.idle trigger (workflows AGENTS.md rule)", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/daily-digest/workflow.ts",
      dailyDigestWorkflow,
    );
    for (const trigger of registered.triggers) {
      expect(trigger.event).not.toBe("runtime.idle");
    }
  });

  it("does not subscribe to its own completion (no self-trigger loop)", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/daily-digest/workflow.ts",
      dailyDigestWorkflow,
    );
    for (const trigger of registered.triggers) {
      if (trigger.event === "workflow.completed") {
        const filterWorkflows = trigger.filter?.workflow;
        const list = Array.isArray(filterWorkflows)
          ? filterWorkflows
          : filterWorkflows
            ? [filterWorkflows]
            : [];
        expect(list).not.toContain("daily-digest");
      }
    }
  });
});

describe("daily-digest build-digest step", () => {
  let projectDir: string;
  let runDir: string;
  let runDirPath: string;
  let emitted: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "daily-digest-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    runDirPath = mkdtempSync(join(tmpdir(), "daily-digest-run-"));
    runDir = ".kota/runs/test-run";
    emitted = [];
    const ownerMod = await import("#core/daemon/owner-question-queue.js");
    ownerMod.resetOwnerQuestionQueue();
    // Bind the mocked queue to a project-local directory.
    ownerMod.getOwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(runDirPath, { recursive: true, force: true });
  });

  it("emits workflow.daily.digest event and writes both artifact files", async () => {
    const buildStep = dailyDigestWorkflow.steps[0];
    if (buildStep.type !== "code") throw new Error("expected code step");

    await buildStep.run({
      projectDir,
      workflow: {
        name: "daily-digest",
        definitionPath: "src/modules/autonomy/workflows/daily-digest/workflow.ts",
        runId: "test-run",
        runDir,
        runDirPath,
      },
      trigger: { event: "schedule", payload: {} },
      previousOutput: undefined,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runTool: () => {
        throw new Error("not used");
      },
      emit: (event, payload) => emitted.push({ event, payload }),
      requestRestart: () => {},
      readPrompt: () => "",
      readRuntimeState: () => ({
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      }),
      reportProgress: () => {},
      triggerWorkflow: async () => ({ runId: "x", status: "queued" as const }),
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe(DAILY_DIGEST_EVENT);
    expect(emitted[0].payload.text).toContain("Daily digest");
    expect(emitted[0].payload.quiet).toBe(true);

    const txt = readFileSync(join(runDirPath, DAILY_DIGEST_DIGEST_TXT), "utf-8");
    expect(txt).toContain("Daily digest");
    const json = JSON.parse(
      readFileSync(join(runDirPath, DAILY_DIGEST_DIGEST_JSON), "utf-8"),
    );
    expect(json.quiet).toBe(true);
    expect(json.queueDelta).toBeDefined();

    const state = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME),
        "utf-8",
      ),
    );
    expect(state.counts).toBeDefined();
    expect(typeof state.capturedAt).toBe("string");
  });

  it("computes a delta on the second invocation using the persisted snapshot", async () => {
    const buildStep = dailyDigestWorkflow.steps[0];
    if (buildStep.type !== "code") throw new Error("expected code step");

    const ctxBase = {
      projectDir,
      trigger: { event: "schedule", payload: {} },
      previousOutput: undefined,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runTool: () => {
        throw new Error("not used");
      },
      requestRestart: () => {},
      readPrompt: () => "",
      readRuntimeState: () => ({
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      }),
      reportProgress: () => {},
      triggerWorkflow: async () => ({ runId: "x", status: "queued" as const }),
    };

    await buildStep.run({
      ...ctxBase,
      workflow: {
        name: "daily-digest",
        definitionPath: "x",
        runId: "first",
        runDir: ".kota/runs/first",
        runDirPath,
      },
      emit: () => {},
    });

    // Add a ready task between snapshots so the second run sees a +1 delta.
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    const fs = await import("node:fs");
    fs.writeFileSync(
      join(projectDir, "data", "tasks", "ready", "task-newcomer.md"),
      "---\nid: task-newcomer\n---\n",
    );

    const secondRunDirPath = mkdtempSync(join(tmpdir(), "daily-digest-second-"));
    const secondEmitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
    await buildStep.run({
      ...ctxBase,
      workflow: {
        name: "daily-digest",
        definitionPath: "x",
        runId: "second",
        runDir: ".kota/runs/second",
        runDirPath: secondRunDirPath,
      },
      emit: (event, payload) => secondEmitted.push({ event, payload }),
    });

    const secondJson = JSON.parse(
      readFileSync(join(secondRunDirPath, DAILY_DIGEST_DIGEST_JSON), "utf-8"),
    );
    expect(secondJson.queueDelta.previous).toEqual({
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 0,
    });
    expect(secondJson.queueDelta.delta.ready).toBe(1);
    rmSync(secondRunDirPath, { recursive: true, force: true });
  });
});
