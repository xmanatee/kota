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
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import decomposerWorkflow from "./workflow.js";

const EXTERNAL_MARKER = "SIBLING_PROJECT_TASK_SECRET_MUST_NOT_REACH_AGENT";
const TASK_ID = "task-linked-decomposer-target";
const RUN_ID = "run-linked-decomposer-target";

describe("decomposer task read security", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not expose a sibling-project task reached through a task symlink", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-decomposer-task-read-"));
    roots.push(root);
    const projectDir = join(root, "project");
    const siblingProjectDir = join(root, "sibling-project");
    const doingDir = join(projectDir, "data", "tasks", "doing");
    const siblingReadyDir = join(siblingProjectDir, "data", "tasks", "ready");
    const runDir = join(projectDir, ".kota", "runs", RUN_ID);
    mkdirSync(doingDir, { recursive: true });
    mkdirSync(siblingReadyDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    const externalTaskPath = join(siblingReadyDir, `${TASK_ID}.md`);
    writeFileSync(
      externalTaskPath,
      `---\nid: ${TASK_ID}\ntitle: External sibling task\nstatus: ready\nupdated_at: 2026-08-06T00:00:00.000Z\n---\n\n## Problem\n\n${EXTERNAL_MARKER}\n`,
      "utf8",
    );
    symlinkSync(externalTaskPath, join(doingDir, `${TASK_ID}.md`));

    writeFileSync(
      join(runDir, "metadata.json"),
      `${JSON.stringify({
        id: RUN_ID,
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: {},
        },
        startedAt: "2026-08-06T00:00:00.000Z",
        completedAt: "2026-08-06T04:00:00.000Z",
        status: "failed",
        durationMs: 14_400_000,
        runDir: `.kota/runs/${RUN_ID}`,
        steps: [
          {
            id: "build",
            type: "agent",
            status: "failed",
            startedAt: "2026-08-06T00:00:00.000Z",
            completedAt: "2026-08-06T04:00:00.000Z",
            durationMs: 14_400_000,
            errorKind: "step-timeout",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(runDir, "task-claim.json"),
      `${JSON.stringify({
        claimed: true,
        taskId: TASK_ID,
        claim: {
          schemaVersion: 2,
          taskId: TASK_ID,
          taskState: "ready",
          taskFile: {
            path: `data/tasks/ready/${TASK_ID}.md`,
            snapshot: {
              dev: 1,
              ino: 1,
              size: 1,
              mtimeMs: 1,
              ctimeMs: 1,
            },
          },
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: {
          workflow: "builder",
          runId: RUN_ID,
          status: "failed",
          runDir: `.kota/runs/${RUN_ID}`,
        },
      },
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps.decompose).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(EXTERNAL_MARKER);
  });
});
