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
import { RunCoordinator } from "./run-coordinator.js";
import type { RepositoryAccess } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

function createRuntime(
  config: Omit<
    WorkflowRuntimeConfig,
    "scopeId" | "runState" | "runCoordinator" | "daemonEpoch"
  > & { scopeRoot: string },
): { runtime: WorkflowRuntime; runState: RunStateDatabase } {
  const runState = new RunStateDatabase(join(config.scopeRoot, ".kota", "state"));
  const scopeId = "write-scope-test";
  runState.registerScope({
    id: scopeId,
    rootPath: config.scopeRoot,
    createdAt: "2026-08-25T10:00:00.000Z",
  });
  const daemonEpoch = runState.beginDaemonSession("2026-08-25T10:00:00.000Z").epoch;
  let runtime!: WorkflowRuntime;
  const runCoordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 2,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) => runtime.deliverPublication(publication),
  });
  runtime = new WorkflowRuntime({
    ...config,
    scopeId,
    runState,
    runCoordinator,
    daemonEpoch,
  });
  return { runtime, runState };
}

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

function makeScopeRoot(): string {
  const workspaceRoot = join(
    tmpdir(),
    `kota-write-scope-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: workspaceRoot, stdio: "ignore" },
  );
  return workspaceRoot;
}

function countWorkflowRuns(workspaceRoot: string, workflowName: string): number {
  const runsDir = join(workspaceRoot, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => {
    const metadataPath = join(runsDir, runId, "metadata.json");
    if (!existsSync(metadataPath)) return false;
    return runId.includes(workflowName);
  }).length;
}

describe("runtime dispatch write-scope attribution", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("propagates each declared repository mode to its run-owned sandbox", async () => {
    type Observation = {
      branch: string | null;
      hasGitMetadata: boolean;
      workspaceRoot: string;
      scopeRoot: string;
    };
    const observed = new Map<RepositoryAccess, Observation>();
    const modes = ["none", "read", "write"] as const;
    const workflows: RegisteredWorkflowDefinitionInput[] = modes.map((repository) => ({
      name: `repository-${repository}`,
      definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
      moduleRoot: workspaceRoot,
      repository,
      ...(repository === "write"
        ? { integration: { validationCommand: ["true"] as const } }
        : {}),
      triggers: [{ event: "manual", cooldownMs: 0 }],
      steps: [{
        id: "observe-sandbox",
        type: "code",
        run: async (context) => {
          const hasGitMetadata = existsSync(join(context.workspaceRoot, ".git"));
          const branch = hasGitMetadata
            ? (await context.runCommand({
                command: "git",
                args: ["branch", "--show-current"],
              })).stdout.text.trim()
            : null;
          observed.set(repository, {
            branch,
            hasGitMetadata,
            workspaceRoot: context.workspaceRoot,
            scopeRoot: context.scopeRoot,
          });
        },
      }],
    }));

    const { runtime, runState } = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows,
    });

    runtime.start();
    try {
      for (const repository of modes) {
        expect(runtime.enqueuePendingRun(`repository-${repository}`).ok).toBe(true);
      }
      await waitUntil(
        () => observed.size === modes.length && !runtime.isBusy(),
        "Timed out waiting for repository authority probes",
      );
    } finally {
      await runtime.stop();
      runState.close();
    }

    expect(observed.get("none")).toMatchObject({
      branch: null,
      hasGitMetadata: false,
      scopeRoot: workspaceRoot,
    });
    expect(observed.get("none")?.workspaceRoot).not.toBe(workspaceRoot);
    expect(observed.get("read")).toMatchObject({
      branch: "",
      hasGitMetadata: true,
      scopeRoot: workspaceRoot,
    });
    expect(observed.get("read")?.workspaceRoot).not.toBe(workspaceRoot);
    expect(observed.get("write")).toMatchObject({
      hasGitMetadata: true,
      scopeRoot: workspaceRoot,
    });
    expect(observed.get("write")?.branch).toMatch(/^kota\/run\//);
    expect(observed.get("write")?.workspaceRoot).not.toBe(workspaceRoot);
  });

  it("keeps shared-workspace agent write-scope snapshots from blaming concurrent agent edits", async () => {
    const harnessName =
      `runtime-dispatch-write-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(join(workspaceRoot, "prompt.md"), "Review.\n");

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
            options.cwd ?? workspaceRoot,
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

    const { runtime, runState } = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "builder",
          definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
          moduleRoot: workspaceRoot,
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
          repository: "read",
          name: "progress-reviewer",
          definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
          moduleRoot: workspaceRoot,
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
          countWorkflowRuns(workspaceRoot, "builder") === 1 &&
          countWorkflowRuns(workspaceRoot, "progress-reviewer") === 1 &&
          !runtime.isBusy(),
        "Timed out waiting for shared-workspace agent runs",
      );
    } finally {
      await runtime.stop();
      runState.close();
    }

    expect(builderCompletedAt).toBeGreaterThan(0);
    expect(reviewerStartedAt).toBeLessThan(builderCompletedAt);

    const progressRunId = readdirSync(join(workspaceRoot, ".kota", "runs")).find(
      (runId) => runId.includes("progress-reviewer"),
    );
    expect(progressRunId).toBeDefined();
    const metadata = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".kota", "runs", progressRunId!, "metadata.json"),
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
          workspaceRoot,
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
