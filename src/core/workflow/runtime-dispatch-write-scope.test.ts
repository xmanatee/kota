import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRuntime } from "./runtime.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  if (predicate()) return;
  throw new Error(message);
}

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-write-scope-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

function countWorkflowRuns(projectDir: string, workflowName: string): number {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => {
    const metadataPath = join(runsDir, runId, "metadata.json");
    if (!existsSync(metadataPath)) return false;
    return runId.includes(workflowName);
  }).length;
}

describe("runtime dispatch write-scope attribution", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps shared-workspace agent write-scope snapshots from blaming concurrent agent edits", async () => {
    const harnessName =
      `runtime-dispatch-write-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(join(projectDir, "prompt.md"), "Review.\n");

    let builderStartedAt = 0;
    let builderCompletedAt = 0;
    let reviewerStartedAt = 0;

    registerAgentHarness({
      name: harnessName,
      description: "runtime dispatch write-scope harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        if (options.workflowContext?.workflowName === "builder") {
          builderStartedAt = Date.now();
          await wait(80);
          const target = join(
            options.cwd ?? projectDir,
            "src",
            "modules",
            "autonomy",
            "workflows",
            "builder",
            "runtime-resources.ts",
          );
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, "export const touchedByBuilder = true;\n");
          builderCompletedAt = Date.now();
        } else if (options.workflowContext?.workflowName === "progress-reviewer") {
          reviewerStartedAt = Date.now();
          await wait(120);
        }
        return {
          text: "done",
          streamedText: "done",
          turns: 1,
          isError: false,
        };
      },
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      agentConcurrency: 2,
      workflows: [
        {
          name: "builder",
          definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
          moduleRoot: projectDir,
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [
            {
              id: "build",
              type: "agent",
              agentName: "builder",
              harness: harnessName,
              promptPath: "prompt.md",
              model: "test-model",
              effort: "low",
              autonomyMode: "autonomous",
              timeoutMs: 10_000,
            },
          ],
        },
        {
          name: "progress-reviewer",
          definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
          moduleRoot: projectDir,
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [
            {
              id: "review-evidence",
              type: "agent",
              agentName: "progress-reviewer",
              harness: harnessName,
              promptPath: "prompt.md",
              model: "test-model",
              effort: "low",
              autonomyMode: "passive",
              timeoutMs: 10_000,
            },
          ],
        },
      ],
      resolveAgentDef: (name) => {
        if (name === "builder") {
          return {
            name,
            role: "Mutate builder files.",
            promptPath: "prompt.md",
            model: "test-model",
            effort: "low",
            writeScope: [],
          };
        }
        if (name === "progress-reviewer") {
          return {
            name,
            role: "Review evidence without mutating source files.",
            promptPath: "prompt.md",
            model: "test-model",
            effort: "low",
            writeScope: [".kota/runs/"],
          };
        }
        return undefined;
      },
    });

    runtime.start();
    try {
      expect(runtime.enqueuePendingRun("builder").ok).toBe(true);
      await waitUntil(() => builderStartedAt > 0, "Timed out waiting for builder agent");

      expect(runtime.enqueuePendingRun("progress-reviewer").ok).toBe(true);
      await waitUntil(
        () =>
          countWorkflowRuns(projectDir, "builder") === 1 &&
          countWorkflowRuns(projectDir, "progress-reviewer") === 1 &&
          !runtime.isBusy(),
        "Timed out waiting for shared-workspace agent runs",
      );
    } finally {
      await runtime.stop();
    }

    expect(builderCompletedAt).toBeGreaterThan(0);
    expect(reviewerStartedAt).toBeGreaterThanOrEqual(builderCompletedAt);

    const progressRunId = readdirSync(join(projectDir, ".kota", "runs")).find(
      (runId) => runId.includes("progress-reviewer"),
    );
    expect(progressRunId).toBeDefined();
    const metadata = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", "runs", progressRunId!, "metadata.json"),
        "utf-8",
      ),
    ) as { status: string; steps: Array<{ id: string; status: string }> };
    expect(metadata.status).toBe("success");
    expect(metadata.steps.find((step) => step.id === "review-evidence")).toMatchObject({
      status: "success",
    });
    expect(
      existsSync(
        join(
          projectDir,
          ".kota",
          "runs",
          progressRunId!,
          "steps",
          "review-evidence.write-scope-violation.json",
        ),
      ),
    ).toBe(false);
  });
});
