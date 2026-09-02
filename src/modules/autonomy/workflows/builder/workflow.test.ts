import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_STEP_ID,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import {
  inspectBuilderTaskTarget,
  listBuilderTaskDispatches,
} from "./task-contract.js";
import builderWorkflow from "./workflow.js";

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-builder-contract-"));
  roots.push(root);
  mkdirSync(join(root, "data", "tasks", "archive"), { recursive: true });
  return root;
}

function writeTask(root: string, state: string, marker = "initial"): void {
  const dir = state === "done" || state === "dropped"
    ? join(root, "data", "tasks", "archive")
    : join(root, "data", "tasks");
  writeFileSync(
    join(dir, "task-target.md"),
    [
      "---",
      `status: ${state}`,
      ...(state === "open" || state === "blocked" ? ["priority: p1"] : []),
      "---",
      "",
      "# Target",
      "",
      marker,
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("targeted builder contract", () => {
  it("binds each run to its task resource and shared write sandbox", () => {
    const trigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {
        taskId: "task-target",
        taskPath: "data/tasks/task-target.md",
        taskState: "open",
        taskDigest: "a".repeat(64),
        idempotencyKey: `builder:task-target:${"a".repeat(64)}`,
      },
    };
    expect(builderWorkflow.repository).toBe("write");
    expect(builderWorkflow.resources?.({
      scopeRoot: "/repo",
      stateDir: "/repo/.kota",
      workflowName: "builder",
      trigger,
    })).toEqual(["task:task-target"]);
    expect(builderWorkflow.triggers).toEqual([
      { event: "autonomy.queue.available", queueMode: "all" },
    ]);
  });

  it("rejects a queued target after its task contract changes", () => {
    const root = project();
    writeTask(root, "open");
    const payload = listBuilderTaskDispatches(root)[0]!;
    writeTask(root, "open", "changed");

    expect(inspectBuilderTaskTarget({ workspaceRoot: root, payload })).toMatchObject({
      actionable: false,
      taskId: "task-target",
      reason: "task contract changed after dispatch",
    });
  });

  it("rechecks the admitted source contract after reconciliation", () => {
    const root = project();
    writeTask(root, "open");
    const payload = listBuilderTaskDispatches(root)[0]!;
    const invariant = builderWorkflow.integration?.postReconcile;
    if (!invariant) throw new Error("missing builder post-reconcile invariant");
    const input = {
      workspaceRoot: root,
      repoRoot: root,
      stateDir: join(root, ".kota"),
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload,
      },
      head: "reconciled-head",
      canonicalHead: "canonical-head",
      signal: new AbortController().signal,
    };

    expect(invariant(input)).toEqual({ satisfied: true });
    writeTask(root, "open", "changed after admission");
    expect(invariant(input)).toMatchObject({
      satisfied: false,
      reason: expect.stringMatching(/no longer matches its admitted source contract/i),
    });
  });

  it("runs build only after target and harness preflights succeed", () => {
    const build = builderWorkflow.steps.find((step) => step.id === "build");
    if (!build || build.type !== "agent" || !build.when) throw new Error("missing build step");
    const target = {
      actionable: true,
      taskId: "task-target",
      taskPath: "data/tasks/task-target.md",
      taskState: "open",
      taskDigest: "a".repeat(64),
      reason: null,
    };
    const context = {
      stepOutputs: { "inspect-target-task": target },
      stepResults: {
        "inspect-target-task": { id: "inspect-target-task", status: "success" },
        "preflight-builder-harness": {
          id: "preflight-builder-harness",
          status: "success",
        },
      },
    };
    expect(build.when(context as never)).toBe(true);
    expect(
      build.when({
        ...context,
        stepOutputs: {
          "inspect-target-task": { ...target, actionable: false, reason: "stale" },
        },
      } as never),
    ).toBe(false);
  });

  it("writes calibration from the builder critic directory, ignoring stale run-root evidence", async () => {
    const root = project();
    const runDir = join(root, ".kota", "runs", "run-builder");
    const criticVerdictRunDir = join(
      root,
      ".kota",
      "builder-evidence",
      "run-builder",
    );
    mkdirSync(runDir, { recursive: true });
    mkdirSync(criticVerdictRunDir, { recursive: true });
    writeTask(root, "done");
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({
        verdict: "fail",
        critical_issues: ["Stale run-root verdict."],
        warnings: [],
        summary: "This verdict belongs to a different evidence source.",
      }),
    );
    writeFileSync(
      join(criticVerdictRunDir, "critic-review.json"),
      JSON.stringify({
        verdict: "pass",
        critical_issues: [],
        warnings: [],
        summary: "The builder result passed independent review.",
        reviewerPromptHash: "builder-critic-prompt",
      }),
    );

    const calibration = builderWorkflow.steps.find(
      (step) => step.id === EVALUATOR_CALIBRATION_STEP_ID,
    );
    if (!calibration || calibration.type !== "code") {
      throw new Error("missing builder calibration step");
    }
    const taskDigest = "a".repeat(64);
    const result = await calibration.run({
      workspaceRoot: root,
      runtimeResources: { agentRunDir: criticVerdictRunDir },
      workflow: {
        name: "builder",
        runId: "run-builder",
        runDirPath: runDir,
      },
      trigger: {
        payload: {
          taskId: "task-target",
          taskPath: "data/tasks/task-target.md",
          taskState: "open",
          taskDigest,
          idempotencyKey: `builder:task-target:${taskDigest}`,
        },
      },
      stepOutputs: { build: { repairIterations: [] } },
      stepResults: { build: { status: "success" } },
    } as never) as EvaluatorCalibrationArtifact;

    expect(result).toMatchObject({
      verdict: "pass",
      criticPromptHash: "builder-critic-prompt",
    });
    expect(
      JSON.parse(
        readFileSync(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), "utf8"),
      ),
    ).toMatchObject({
      verdict: "pass",
      criticPromptHash: "builder-critic-prompt",
    });
  });
});
