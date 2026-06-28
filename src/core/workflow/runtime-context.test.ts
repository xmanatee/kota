import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRuntime } from "./runtime.js";
import { createWorkflowRuntimeContext } from "./runtime-context.js";

describe("WorkflowRuntime context-backed status metadata", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("surfaces observable concurrency and queue metadata from the shared context", () => {
    const ctx = createWorkflowRuntimeContext({
      bus: new EventBus(),
      projectDir,
      workflows: [],
      agentConcurrency: 3,
      codeConcurrency: 2,
    });

    expect(ctx.projectDir).toBe(projectDir);
    expect(ctx.agentConcurrency).toBe(3);
    expect(ctx.codeConcurrency).toBe(2);
    expect(ctx.wfQueue.length).toBe(0);

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
      agentConcurrency: 5,
      codeConcurrency: 6,
    });

    expect(runtime.getState()).toMatchObject({
      agentConcurrency: 5,
      codeConcurrency: 6,
      queueLength: 0,
      pendingRuns: [],
      workflows: {},
    });
  });
});
