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
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => {
    const metadataPath = join(runsDir, runId, "metadata.json");
    if (!existsSync(metadataPath)) return false;
    return runId.includes("idle-listener");
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
});
