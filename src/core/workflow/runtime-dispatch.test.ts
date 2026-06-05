import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRuntime } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-idle-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

const idleWorkflow: RegisteredWorkflowDefinitionInput = {
  name: "idle-listener",
  definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
  moduleRoot: process.cwd(),
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [
    {
      id: "noop",
      type: "code",
      run: () => ({ ok: true }),
    },
  ],
};

function countIdleRuns(projectDir: string): number {
  return countWorkflowRuns(projectDir, "idle-listener");
}

function countWorkflowRuns(projectDir: string, workflowName: string): number {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => {
    const metadataPath = join(runsDir, runId, "metadata.json");
    if (!existsSync(metadataPath)) return false;
    return runId.includes(workflowName);
  }).length;
}

describe("runtime idle dispatch", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not keep dispatching runtime.idle while repo state is unchanged", async () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [idleWorkflow],
    });

    runtime.start();
    await wait(120);
    await runtime.stop();

    expect(countIdleRuns(projectDir)).toBe(1);
  });

  it("dispatches runtime.idle again after the repo state changes", async () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [idleWorkflow],
    });

    runtime.start();
    await wait(50);
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(join(projectDir, "data", "inbox", "idea.md"), "New work\n");
    await wait(80);
    await runtime.stop();

    expect(countIdleRuns(projectDir)).toBe(2);
  });

  it("dispatches manually enqueued workflow runs immediately", async () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "manual-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    const result = runtime.enqueuePendingRun("manual-listener");
    await wait(120);
    await runtime.stop();

    expect(result.ok).toBe(true);
    expect(countWorkflowRuns(projectDir, "manual-listener")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });

  it("dispatches webhook-enqueued workflow runs immediately", async () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "webhook-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ webhook: true }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    const result = runtime.enqueueWebhookRun("webhook-listener", {
      body: { ok: true },
      headers: {},
      timestamp: new Date().toISOString(),
    });
    await wait(120);
    await runtime.stop();

    expect(result.ok).toBe(true);
    expect(countWorkflowRuns(projectDir, "webhook-listener")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });

  it("dispatches a workflow emitted by a running code step after an agent slot frees", async () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      agentConcurrency: 1,
      workflows: [
        {
          name: "dispatcher",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [
            {
              id: "emit-events",
              type: "code",
              run: ({ emit }) => {
                emit("autonomy.queue.available", {
                  pullableCount: 1,
                  actionableCount: 1,
                  counts: {
                    backlog: 0,
                    ready: 1,
                    doing: 0,
                    blocked: 0,
                    done: 0,
                    dropped: 0,
                  },
                });
                emit("autonomy.security-review.due", {
                  due: true,
                  reason: "high-risk-security-sensitive-change",
                });
                return { emitted: true };
              },
            },
          ],
        },
        {
          name: "builder-like-agent-slot",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          concurrencyGroup: "agent",
          triggers: [{ event: "autonomy.queue.available", cooldownMs: 0 }],
          steps: [
            {
              id: "hold-agent-slot",
              type: "code",
              run: async () => {
                await wait(80);
                return { ok: true };
              },
            },
          ],
        },
        {
          name: "security-review",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          concurrencyGroup: "agent",
          triggers: [{ event: "autonomy.security-review.due", cooldownMs: 0 }],
          steps: [
            {
              id: "record-review",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    await wait(260);
    await runtime.stop();

    expect(countWorkflowRuns(projectDir, "builder-like-agent-slot")).toBe(1);
    expect(countWorkflowRuns(projectDir, "security-review")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });
});
