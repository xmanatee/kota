import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import decomposerWorkflow from "./workflow.js";
import {
  FAILED_RUN_ID,
  failedBuilderMetadata,
  failedBuilderTrigger,
  immutableTaskPayload,
  prepareTaskProject,
  taskMarkdown,
  writeActionableTask,
  writeRunMetadata,
} from "./workflow-test-support.js";

const EXTERNAL_MARKER = "SIBLING_PROJECT_TASK_SECRET_MUST_NOT_REACH_AGENT";
const TASK_ID = "task-linked-decomposer-target";
const roots: string[] = [];

function project(prefix: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(projectDir);
  return projectDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("decomposer task read security", () => {
  it.each([
    [
      "traversing run identity",
      {
        ...failedBuilderTrigger().payload,
        runId: "../forged-run",
        runDir: ".kota/runs/../forged-run",
      },
    ],
    [
      "mismatched run directory",
      {
        ...failedBuilderTrigger().payload,
        runDir: ".kota/runs/other-builder-run",
      },
    ],
  ])("rejects %s", async (_label, payload) => {
    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload },
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toMatch(
      /path-safe segment|canonical run directory/i,
    );
    expect(result.steps.decompose).toBeUndefined();
  });

  it.each([
    ["id", { id: "run-forged-builder" }],
    ["workflow", { workflow: "improver" }],
    ["status", { status: "success" }],
    ["runDir", { runDir: ".kota/runs/run-forged-builder" }],
  ])("rejects source metadata with mismatched %s", async (_field, patch) => {
    const projectDir = project("kota-decomposer-metadata-");
    const task = writeActionableTask(projectDir, TASK_ID);
    const metadata = {
      ...failedBuilderMetadata(task, { errorKind: "step-timeout" }),
      ...patch,
    } as WorkflowRunMetadata;
    writeRunMetadata(projectDir, FAILED_RUN_ID, metadata);

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      projectDir,
      trigger: failedBuilderTrigger(),
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toContain(
      "must identify failed builder run",
    );
    expect(result.steps.decompose).toBeUndefined();
  });

  it("rejects source metadata without the immutable builder task contract", async () => {
    const projectDir = project("kota-decomposer-contract-");
    const task = writeActionableTask(projectDir, TASK_ID);
    const metadata = failedBuilderMetadata(task, { errorKind: "step-timeout" });
    metadata.trigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { taskId: TASK_ID },
    };
    writeRunMetadata(projectDir, FAILED_RUN_ID, metadata);

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      projectDir,
      trigger: failedBuilderTrigger(),
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toContain(
      "immutable task contract",
    );
    expect(result.steps.decompose).toBeUndefined();
  });

  it("does not expose a sibling-project task reached through a task symlink", async () => {
    const root = project("kota-decomposer-task-read-");
    const projectDir = join(root, "project");
    const siblingProjectDir = join(root, "sibling-project");
    prepareTaskProject(projectDir);
    const siblingReadyDir = join(siblingProjectDir, "data", "tasks", "ready");
    mkdirSync(siblingReadyDir, { recursive: true });

    const externalTaskPath = join(siblingReadyDir, `${TASK_ID}.md`);
    writeFileSync(
      externalTaskPath,
      taskMarkdown(TASK_ID, "doing", EXTERNAL_MARKER),
      "utf8",
    );
    symlinkSync(
      externalTaskPath,
      join(projectDir, "data", "tasks", "doing", `${TASK_ID}.md`),
    );

    const metadata = failedBuilderMetadata(
      immutableTaskPayload(TASK_ID),
      { errorKind: "step-timeout" },
    );
    writeRunMetadata(projectDir, FAILED_RUN_ID, metadata);

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      projectDir,
      trigger: failedBuilderTrigger(),
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toMatch(/symbolic[- ]link/i);
    expect(result.steps.decompose).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(EXTERNAL_MARKER);
  });
});
