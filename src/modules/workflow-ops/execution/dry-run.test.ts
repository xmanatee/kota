import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { buildDryRunPlan, formatDryRunPlan, formatDryRunResult } from "./dry-run.js";
import { registerRunCommand } from "./run.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test-workflow",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [{ event: "manual", cooldownMs: 0 }],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-workflow-dry-run-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# Test Project\n", "utf-8");
  return dir;
}

function makeRunCliProgram(ctx: ModuleContext): Command {
  const program = new Command("workflow");
  program.exitOverride();
  registerRunCommand(program, ctx);
  return program;
}

describe("workflow run --dry-run", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the run plan without creating run artifacts, emitting bus events, or executing steps", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    let stepExecuted = false;
    const definition = makeDefinition({
      moduleRoot: projectDir,
      steps: [
        {
          id: "would-execute",
          type: "code",
          run: ({ emit }) => {
            stepExecuted = true;
            emit("dry-run.executed", { ok: true });
            writeFileSync(join(projectDir, "executed.txt"), "should not exist", "utf-8");
            return { ok: true };
          },
        },
      ],
    });
    const ctx = {
      cwd: projectDir,
      config: {},
      getContributedWorkflows: () => [definition],
      listTools: () => [],
      client: {
        workflow: {
          abortRun: vi.fn(),
        },
      },
    } as unknown as ModuleContext;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const eventSpy = vi.spyOn(EventBus.prototype, "emit");
    const program = makeRunCliProgram(ctx);

    await program.parseAsync([
      "node",
      "workflow",
      "run",
      "test-workflow",
      "--dry-run",
    ]);

    expect(String(log.mock.calls[0]?.[0] ?? "")).toContain("Result: PASS");
    expect(stepExecuted).toBe(false);
    expect(existsSync(join(projectDir, "executed.txt"))).toBe(false);
    expect(existsSync(join(projectDir, ".kota", "runs"))).toBe(false);
    expect(eventSpy).not.toHaveBeenCalled();
  });
});

describe("buildDryRunPlan", () => {
  it("returns step plan with no-condition for steps without when", async () => {
    const def = makeDefinition({
      steps: [{ id: "my-step", type: "code", run: () => "ok" }],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.name).toBe("test-workflow");
    expect(plan.definitionPath).toBe("src/modules/test/workflows/test/workflow.ts");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe("my-step");
    expect(plan.steps[0].whenResult).toBe("no-condition");
  });

  it("marks steps skipped when when predicate returns false with empty context", async () => {
    const def = makeDefinition({
      steps: [{ id: "skipped-step", type: "code", run: () => null, when: () => false }],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].whenResult).toBe("skipped");
  });

  it("marks steps as runs when when predicate returns true with empty context", async () => {
    const def = makeDefinition({
      steps: [{ id: "running-step", type: "code", run: () => null, when: () => true }],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].whenResult).toBe("runs");
  });

  it("marks steps error when when predicate throws", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "error-step",
          type: "code",
          run: () => null,
          when: () => {
            throw new Error("bad context access");
          },
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].whenResult).toBe("error");
    expect(plan.steps[0].whenError).toBe("bad context access");
  });

  it("marks step skipped when when predicate accesses empty stepOutputs", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "conditional-step",
          type: "code",
          run: () => null,
          when: ({ stepOutputs }) => Boolean(stepOutputs["prior-step"]),
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].whenResult).toBe("skipped");
  });

  it("includes children for parallel steps", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "parallel-group",
          type: "parallel",
          steps: [
            { id: "child-a", type: "code", run: () => null },
            { id: "child-b", type: "code", run: () => null },
          ],
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].children).toHaveLength(2);
    expect(plan.steps[0].children![0].id).toBe("child-a");
    expect(plan.steps[0].children![1].id).toBe("child-b");
    expect(plan.steps[0].children![0].whenResult).toBe("no-condition");
  });

  it("shows correct config for agent step", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "build",
          type: "agent",
          promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
          harness: "claude-agent-sdk",
          moduleRoot: "/test-module-root",
          model: "claude-opus-4-7",
          effort: "xhigh",
          autonomyMode: "autonomous",
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].config).toContain("agent");
    expect(plan.steps[0].config).toContain("claude-opus-4-7");
    expect(plan.steps[0].config).toContain("prompt.md");
  });

  it("shows correct config for tool step", async () => {
    const def = makeDefinition({
      steps: [{ id: "lint", type: "tool", tool: "shell" }],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].config).toBe("tool: shell");
  });

  it("shows retry info in tool step config", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "test",
          type: "tool",
          tool: "shell",
          retry: { maxAttempts: 3, initialDelayMs: 1000, backoffFactor: 2 },
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].config).toContain("retry: 3x");
  });

  it("shows correct config for emit step", async () => {
    const def = makeDefinition({
      steps: [{ id: "emit-done", type: "emit", event: "workflow.done" }],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[0].config).toBe("emit: workflow.done");
  });

  it("shows correct config for restart step", async () => {
    const def = makeDefinition({
      steps: [
        { id: "verify", type: "code", run: () => true },
        { id: "end", type: "restart", requires: ["verify"] },
      ],
    });
    const plan = await buildDryRunPlan(def);
    expect(plan.steps[1].config).toContain("restart");
    expect(plan.steps[1].config).toContain("verify");
  });
});

describe("buildDryRunPlan with options", () => {
  afterEach(() => {
    resetModuleEventRegistry();
  });

  it("passes when all tools are available", async () => {
    const def = makeDefinition({
      steps: [{ id: "lint", type: "tool", tool: "shell" }],
    });
    const result = await buildDryRunPlan(def, {
      availableToolNames: new Set(["shell", "delegate"]),
    });
    expect(result.pass).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails when a tool step references a missing tool", async () => {
    const def = makeDefinition({
      steps: [{ id: "lint", type: "tool", tool: "nonexistent-tool" }],
    });
    const result = await buildDryRunPlan(def, {
      availableToolNames: new Set(["shell", "delegate"]),
    });
    expect(result.pass).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].level).toBe("error");
    expect(result.diagnostics[0].stepId).toBe("lint");
    expect(result.diagnostics[0].message).toContain("nonexistent-tool");
    expect(result.diagnostics[0].message).toContain("not registered");
  });

  it("checks tool availability in nested parallel steps", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "parallel-group",
          type: "parallel",
          steps: [
            { id: "child-a", type: "code", run: () => null },
          ],
        },
      ],
    });
    const result = await buildDryRunPlan(def, {
      availableToolNames: new Set(["shell"]),
    });
    expect(result.pass).toBe(true);
  });

  it("matches trigger against provided payload", async () => {
    const def = makeDefinition({
      triggers: [
        { event: "task.ready", cooldownMs: 0, filter: { area: "workflows" } },
      ],
      steps: [{ id: "build", type: "code", run: () => null }],
    });
    const result = await buildDryRunPlan(def, {
      payload: { area: "workflows" },
    });
    expect(result.pass).toBe(true);
    expect(result.triggerMatch).toBeDefined();
    expect(result.triggerMatch!.matched).toBe(true);
    expect(result.triggerMatch!.matchedEvent).toBe("task.ready");
  });

  it("resolves registered event schema refs for trigger match and step context", async () => {
    const event = defineDaemonWideModuleEvent<{
      status: string;
      actor: { id: string; trust: "trusted" | "blocked" };
    }>(
      "task.ready",
      ["status", "actor"],
      {
        schemaVersion: 3,
        payloadSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
            actor: {
              type: "object",
              properties: {
                id: { type: "string" },
                trust: { type: "string", enum: ["trusted", "blocked"] },
              },
            },
          },
        },
      },
    );
    initModuleEventRegistry().register("dry-run-test", event);

    let observedTrigger: WorkflowRunTrigger | undefined;
    const payload = {
      status: "ready",
      actor: { id: "user-1", trust: "trusted" },
    };
    const def = makeDefinition({
      triggers: [
        {
          event: event.name,
          schemaVersion: 3,
          cooldownMs: 0,
          filter: { "actor.trust": "trusted" },
        },
      ],
      steps: [
        {
          id: "capture-trigger",
          type: "code",
          run: () => null,
          when: ({ trigger }) => {
            observedTrigger = trigger;
            return trigger.schemaRef?.version === 3;
          },
        },
      ],
    });

    const result = await buildDryRunPlan(def, { payload });

    expect(result.pass).toBe(true);
    expect(result.triggerMatch).toMatchObject({
      matched: true,
      matchedEvent: event.name,
      schemaRef: { name: event.name, version: 3 },
    });
    expect(observedTrigger).toEqual({
      event: event.name,
      schemaRef: { name: event.name, version: 3 },
      payload,
    });
    expect(result.steps[0].whenResult).toBe("runs");
  });

  it("fails when a matched registered event payload violates its schema", async () => {
    const event = defineDaemonWideModuleEvent<{ status: string }>(
      "task.schema.checked",
      ["status"],
      {
        payloadSchema: {
          type: "object",
          properties: { status: { type: "string" } },
          additionalProperties: false,
        },
      },
    );
    initModuleEventRegistry().register("dry-run-test", event);

    const def = makeDefinition({
      triggers: [{ event: event.name, cooldownMs: 0 }],
      steps: [{ id: "step", type: "code", run: () => null }],
    });

    const result = await buildDryRunPlan(def, {
      payload: { status: 42 },
    });

    expect(result.pass).toBe(false);
    expect(result.triggerMatch).toMatchObject({
      matched: true,
      matchedEvent: event.name,
      schemaRef: { name: event.name, version: 1 },
    });
    expect(result.diagnostics[0].level).toBe("error");
    expect(result.diagnostics[0].message).toContain("failed schema v1");
  });

  it("fails when no trigger matches the provided payload", async () => {
    const def = makeDefinition({
      triggers: [
        { event: "task.ready", cooldownMs: 0, filter: { area: "workflows" } },
      ],
      steps: [{ id: "build", type: "code", run: () => null }],
    });
    const result = await buildDryRunPlan(def, {
      payload: { area: "something-else" },
    });
    expect(result.pass).toBe(false);
    expect(result.triggerMatch!.matched).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].level).toBe("error");
    expect(result.diagnostics[0].message).toContain("no trigger matches");
  });

  it("reports multiple diagnostics for several missing tools", async () => {
    const def = makeDefinition({
      steps: [
        { id: "step-a", type: "tool", tool: "missing-a" },
        { id: "step-b", type: "tool", tool: "missing-b" },
      ],
    });
    const result = await buildDryRunPlan(def, {
      availableToolNames: new Set(["shell"]),
    });
    expect(result.pass).toBe(false);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].stepId).toBe("step-a");
    expect(result.diagnostics[1].stepId).toBe("step-b");
  });

  it("passes with no options (backward compatible)", async () => {
    const def = makeDefinition({
      steps: [{ id: "step-one", type: "code", run: () => null }],
    });
    const result = await buildDryRunPlan(def);
    expect(result.pass).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.triggerMatch).toBeUndefined();
  });
});

describe("formatDryRunPlan", () => {
  it("includes workflow name, definition path, and step count", async () => {
    const def = makeDefinition({
      steps: [{ id: "step-one", type: "code", run: () => null }],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).toContain("test-workflow");
    expect(output).toContain("src/modules/test/workflows/test/workflow.ts");
    expect(output).toContain("Steps (1)");
    expect(output).toContain("step-one");
  });

  it("notes when predicate returning false as would-skip", async () => {
    const def = makeDefinition({
      steps: [{ id: "maybe-step", type: "code", run: () => null, when: () => false }],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).toContain("would skip");
  });

  it("notes when predicate returning true as runs", async () => {
    const def = makeDefinition({
      steps: [{ id: "active-step", type: "code", run: () => null, when: () => true }],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).toContain("true with empty context");
  });

  it("notes when predicate error with message", async () => {
    const def = makeDefinition({
      steps: [
        {
          id: "bad-step",
          type: "code",
          run: () => null,
          when: () => {
            throw new Error("oops");
          },
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).toContain("error");
    expect(output).toContain("oops");
  });

  it("counts parallel children in total step count", async () => {
    const def = makeDefinition({
      steps: [
        { id: "first", type: "code", run: () => null },
        {
          id: "parallel-group",
          type: "parallel",
          steps: [
            { id: "child-a", type: "code", run: () => null },
            { id: "child-b", type: "code", run: () => null },
          ],
        },
      ],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).toContain("Steps (4)");
    expect(output).toContain("child-a");
    expect(output).toContain("child-b");
  });

  it("shows no condition annotation for steps without when", async () => {
    const def = makeDefinition({
      steps: [{ id: "always-step", type: "code", run: () => null }],
    });
    const plan = await buildDryRunPlan(def);
    const output = formatDryRunPlan(plan);
    expect(output).not.toContain("when:");
  });
});

describe("formatDryRunResult", () => {
  it("shows PASS for valid workflow", async () => {
    const def = makeDefinition({
      steps: [{ id: "step-one", type: "code", run: () => null }],
    });
    const result = await buildDryRunPlan(def);
    const output = formatDryRunResult(result);
    expect(output).toContain("Result: PASS");
  });

  it("shows FAIL with diagnostics for missing tool", async () => {
    const def = makeDefinition({
      steps: [{ id: "lint", type: "tool", tool: "nonexistent" }],
    });
    const result = await buildDryRunPlan(def, {
      availableToolNames: new Set(["shell"]),
    });
    const output = formatDryRunResult(result);
    expect(output).toContain("Result: FAIL");
    expect(output).toContain("Diagnostics:");
    expect(output).toContain("ERROR");
    expect(output).toContain("nonexistent");
  });

  it("shows trigger match info", async () => {
    const def = makeDefinition({
      triggers: [{ event: "manual", cooldownMs: 0 }],
      steps: [{ id: "step", type: "code", run: () => null }],
    });
    const result = await buildDryRunPlan(def, { payload: {} });
    const output = formatDryRunResult(result);
    expect(output).toContain("Trigger: matched");
  });

});
