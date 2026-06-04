import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineAutomation, defineHook } from "./automation.js";
import { WorkflowRunStore } from "./run-store.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

const definitionPath = "src/modules/test/workflows/release-gate/workflow.ts";

const tempProjects: string[] = [];

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-automation-test-"));
  tempProjects.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempProjects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("automation authoring adapter", () => {
  it("compiles hook-style event authoring into a normal workflow run contract", () => {
    const projectDir = createTempProject();
    const workflowInput = defineHook({
      name: "release-gate",
      description: "Gate release work on a task event.",
      concurrencyGroup: "operator-hook",
      on: {
        event: "task.ready",
        filter: { area: "core" },
        cooldownMs: 1_500,
      },
      steps: [
        {
          id: "owner-approval",
          type: "approval",
          reason: "Release gate approval",
          defaultResolution: "deny",
        },
        {
          id: "notify",
          type: "emit",
          event: "automation.release-gate.done",
          payload: (ctx) => ({ taskId: ctx.trigger.payload.taskId }),
        },
      ],
    });

    expect(Object.hasOwn(workflowInput, "kind")).toBe(false);
    expect(Object.hasOwn(workflowInput, "on")).toBe(false);
    expect(workflowInput.triggers).toEqual([
      {
        event: "task.ready",
        filter: { area: "core" },
        cooldownMs: 1_500,
      },
    ]);

    const registered = registerWorkflowDefinition(definitionPath, workflowInput);
    const [validated] = validateWorkflowDefinitions([registered], projectDir);

    expect(validated).toMatchObject({
      name: "release-gate",
      definitionPath,
      concurrencyGroup: "operator-hook",
      triggers: [
        {
          event: "task.ready",
          filter: { area: "core" },
          cooldownMs: 1_500,
        },
      ],
    });
    expect(validated.steps[0]).toMatchObject({
      id: "owner-approval",
      type: "approval",
      defaultResolution: "deny",
    });
    expect(validated.steps[1]).toMatchObject({
      id: "notify",
      type: "emit",
      event: "automation.release-gate.done",
    });

    const store = new WorkflowRunStore(projectDir);
    const trigger = {
      event: "task.ready",
      schemaRef: null, payload: {
        _runId: "hook-run-1",
        taskId: "task-123",
        projectId: "scope-1",
      },
    };
    store.createRun(validated, trigger);

    const metadata = store.getRun("hook-run-1");
    expect(metadata).toMatchObject({
      id: "hook-run-1",
      workflow: "release-gate",
      definitionPath,
      runDir: ".kota/runs/hook-run-1",
      status: "running",
      trigger,
    });

    const workflowSnapshot = JSON.parse(
      readFileSync(join(projectDir, ".kota", "runs", "hook-run-1", "workflow.json"), "utf-8"),
    );
    expect(workflowSnapshot).toMatchObject({
      name: "release-gate",
      triggers: [{ event: "task.ready" }],
      steps: [
        { id: "owner-approval", type: "approval" },
        { id: "notify", type: "emit" },
      ],
    });
  });

  it("keeps schedule, watch, interval, and webhook automations on workflow triggers", () => {
    const projectDir = createTempProject();
    const workflowInput = defineAutomation({
      kind: "automation",
      name: "automation-intake",
      on: [
        { schedule: "0 9 * * *", cooldownMs: 60_000 },
        { intervalMs: 3_600_000 },
        { watch: "data/tasks/**/*.md", debounceMs: 750 },
        { webhook: true },
      ],
      steps: [{ id: "emit", type: "emit", event: "automation.intake.tick" }],
    });

    const [validated] = validateWorkflowDefinitions(
      [registerWorkflowDefinition("src/modules/test/workflows/intake/workflow.ts", workflowInput)],
      projectDir,
    );

    expect(validated.triggers).toEqual([
      { event: "schedule", cooldownMs: 60_000, schedule: "0 9 * * *", timezone: undefined },
      { event: "schedule", cooldownMs: 0, intervalMs: 3_600_000 },
      {
        event: "files.changed",
        cooldownMs: 0,
        watch: ["data/tasks/**/*.md"],
        debounceMs: 750,
      },
      { event: "webhook", cooldownMs: 0, webhook: true },
    ]);
  });
});
