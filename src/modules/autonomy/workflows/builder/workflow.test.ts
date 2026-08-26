import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectBuilderTaskTarget,
  listBuilderTaskDispatches,
} from "./task-contract.js";
import builderWorkflow from "./workflow.js";

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-builder-contract-"));
  roots.push(root);
  for (const state of ["ready", "doing", "backlog", "blocked", "done", "dropped"]) {
    mkdirSync(join(root, "data", "tasks", state), { recursive: true });
  }
  return root;
}

function writeTask(root: string, state: string, marker = "initial"): void {
  writeFileSync(
    join(root, "data", "tasks", state, "task-target.md"),
    [
      "---",
      "id: task-target",
      "title: Target",
      `status: ${state}`,
      "priority: p1",
      "area: runtime",
      "task_class: Product",
      "summary: Ship target",
      "updated_at: 2026-08-25T00:00:00.000Z",
      "---",
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
        taskPath: "data/tasks/ready/task-target.md",
        taskState: "ready",
        taskUpdatedAt: "2026-08-25T00:00:00.000Z",
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
    writeTask(root, "ready");
    const payload = listBuilderTaskDispatches(root)[0]!;
    writeTask(root, "ready", "changed");

    expect(inspectBuilderTaskTarget({ workspaceRoot: root, payload })).toMatchObject({
      ready: false,
      taskId: "task-target",
      reason: "task contract changed after dispatch",
    });
  });

  it("rechecks the admitted source contract after reconciliation", () => {
    const root = project();
    writeTask(root, "ready");
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
    writeTask(root, "ready", "changed after admission");
    expect(invariant(input)).toMatchObject({
      satisfied: false,
      reason: expect.stringMatching(/no longer matches its admitted source contract/i),
    });
  });

  it("runs build only after target and harness preflights succeed", () => {
    const build = builderWorkflow.steps.find((step) => step.id === "build");
    if (!build || build.type !== "agent" || !build.when) throw new Error("missing build step");
    const target = {
      ready: true,
      taskId: "task-target",
      taskPath: "data/tasks/ready/task-target.md",
      taskState: "ready",
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
          "inspect-target-task": { ...target, ready: false, reason: "stale" },
        },
      } as never),
    ).toBe(false);
  });
});
