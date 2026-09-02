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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "./run-coordinator.js";
import type { RepositoryAccess } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

// Port binding is an external capability, not behavior owned by this suite.
// Keep the runtime composition real while making its allocator probe deterministic.
vi.mock("node:net", () => ({
  createServer: () => {
    const server = {
      unref: () => server,
      once: () => server,
      listen: (_options: unknown, listening: () => void) => {
        listening();
        return server;
      },
      close: (closed: () => void) => {
        closed();
        return server;
      },
    };
    return server;
  },
}));

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
        run: (context) => {
          const hasGitMetadata = existsSync(join(context.workspaceRoot, ".git"));
          const branch = hasGitMetadata
            ? execFileSync("git", ["branch", "--show-current"], {
                cwd: context.workspaceRoot,
                encoding: "utf8",
              }).trim()
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

  it("isolates security-review attribution from concurrent canonical native writes", async () => {
    const harnessName =
      `runtime-dispatch-write-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tasksDir = join(workspaceRoot, "data", "tasks");
    const preExistingDirtyPath = "data/tasks/planning-existing.md";
    const concurrentStagedPath = "data/tasks/planning-concurrent.md";
    const reviewOutputPath = "data/tasks/security-review-output.md";
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(workspaceRoot, "prompt.md"), "Review.\n");
    writeFileSync(join(workspaceRoot, preExistingDirtyPath), "canonical baseline\n");
    execFileSync("git", ["add", "prompt.md", preExistingDirtyPath], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "fixture"],
      { cwd: workspaceRoot, stdio: "ignore" },
    );
    writeFileSync(join(workspaceRoot, preExistingDirtyPath), "planning draft\n");

    let reviewerStarted = false;
    let reviewerWorkspace = "";
    let reviewerSawExisting = "";
    let reviewerSawConcurrent = false;
    let finishReview = (): void => {};
    const reviewMayFinish = new Promise<void>((resolve) => {
      finishReview = resolve;
    });

    registerAgentHarness({
      name: harnessName,
      description: "runtime dispatch write-scope harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        reviewerWorkspace = options.cwd ?? workspaceRoot;
        reviewerSawExisting = readFileSync(
          join(reviewerWorkspace, preExistingDirtyPath),
          "utf8",
        );
        reviewerSawConcurrent = existsSync(
          join(reviewerWorkspace, concurrentStagedPath),
        );
        reviewerStarted = true;
        await reviewMayFinish;
        return {
          text: "done",
          streamedText: "done",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
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
          repository: "write",
          integration: { validationCommand: ["true"] },
          name: "security-review",
          definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
          moduleRoot: workspaceRoot,
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [
            {
              id: "investigate-candidates",
              type: "agent",
              agentName: "security-reviewer",
              harness: harnessName,
              promptPath: "prompt.md",
              model: "test-model",
              effort: "low",
              autonomyMode: "autonomous",
              timeoutMs: 10_000,
            },
            {
              id: "record-review-outcome",
              type: "code",
              run: (context) => {
                writeFileSync(
                  join(context.workspaceRoot, reviewOutputPath),
                  "security review outcome\n",
                );
              },
            },
          ],
        },
      ],
      resolveAgentDef: (name) => {
        if (name === "security-reviewer") {
          return {
            name,
            role: "Investigate candidates without mutating repository files.",
            promptPath: "prompt.md",
            model: "test-model",
            effort: "low",
            writeScope: "deny-all",
          };
        }
        return undefined;
      },
    });

    runtime.start();
    try {
      expect(runtime.enqueuePendingRun("security-review").ok).toBe(true);
      await waitUntil(
        () => reviewerStarted,
        "Timed out waiting for security reviewer",
      );

      writeFileSync(
        join(workspaceRoot, preExistingDirtyPath),
        "native writer final\n",
      );
      writeFileSync(
        join(workspaceRoot, concurrentStagedPath),
        "native writer addition\n",
      );
      execFileSync("git", ["add", preExistingDirtyPath, concurrentStagedPath], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });
      expect(
        execFileSync("git", ["diff", "--cached", "--name-only"], {
          cwd: workspaceRoot,
          encoding: "utf8",
        }).trim().split("\n").sort(),
      ).toEqual([concurrentStagedPath, preExistingDirtyPath].sort());
      execFileSync(
        "git",
        [
          "-c",
          "user.email=t@t",
          "-c",
          "user.name=T",
          "commit",
          "-m",
          "native writer",
        ],
        { cwd: workspaceRoot, stdio: "ignore" },
      );
      finishReview();
      await waitUntil(
        () =>
          countWorkflowRuns(workspaceRoot, "security-review") === 1 &&
          !runtime.isBusy(),
        "Timed out waiting for security review",
      );
    } finally {
      await runtime.stop();
      runState.close();
    }

    expect(reviewerWorkspace).not.toBe(workspaceRoot);
    expect(reviewerSawExisting).toBe("canonical baseline\n");
    expect(reviewerSawConcurrent).toBe(false);
    expect(readFileSync(join(workspaceRoot, preExistingDirtyPath), "utf8")).toBe(
      "native writer final\n",
    );
    expect(readFileSync(join(workspaceRoot, concurrentStagedPath), "utf8")).toBe(
      "native writer addition\n",
    );
    expect(readFileSync(join(workspaceRoot, reviewOutputPath), "utf8")).toBe(
      "security review outcome\n",
    );
    expect(execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    })).toBe("");

    const securityRunId = readdirSync(join(workspaceRoot, ".kota", "runs")).find(
      (runId) => runId.includes("security-review"),
    );
    expect(securityRunId).toBeDefined();
    const metadata = JSON.parse(
      readFileSync(
        join(workspaceRoot, ".kota", "runs", securityRunId!, "metadata.json"),
        "utf-8",
      ),
    ) as { status: string; steps: Array<{ id: string; status: string }> };
    expect(metadata.status).toBe("success");
    expect(
      metadata.steps.find((step) => step.id === "investigate-candidates"),
    ).toMatchObject({ status: "success" });
    expect(
      metadata.steps.find((step) => step.id === "record-review-outcome"),
    ).toMatchObject({ status: "success" });
    expect(
      existsSync(
        join(
          workspaceRoot,
          ".kota",
          "runs",
          securityRunId!,
          "steps",
          "investigate-candidates.write-scope-violation.json",
        ),
      ),
    ).toBe(false);
  });

  it("fails a genuine deny-all reviewer mutation with inspectable provenance", async () => {
    const harnessName =
      `runtime-dispatch-write-scope-violation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const violationPath = "data/tasks/reviewer-authored.md";
    writeFileSync(join(workspaceRoot, "prompt.md"), "Review.\n");

    registerAgentHarness({
      name: harnessName,
      description: "runtime dispatch write-scope violation harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        const target = join(options.cwd ?? workspaceRoot, violationPath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, "reviewer mutation\n");
        return {
          text: "done",
          streamedText: "done",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    });

    const { runtime, runState } = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [{
        repository: "write",
        integration: { validationCommand: ["true"] },
        name: "security-review",
        definitionPath: "src/core/workflow/runtime-dispatch-write-scope.test.ts",
        moduleRoot: workspaceRoot,
        triggers: [{ event: "manual", cooldownMs: 0 }],
        steps: [{
          id: "investigate-candidates",
          type: "agent",
          agentName: "security-reviewer",
          harness: harnessName,
          promptPath: "prompt.md",
          model: "test-model",
          effort: "low",
          autonomyMode: "autonomous",
          timeoutMs: 10_000,
        }],
      }],
      resolveAgentDef: (name) =>
        name === "security-reviewer"
          ? {
              name,
              role: "Investigate candidates without mutating repository files.",
              promptPath: "prompt.md",
              model: "test-model",
              effort: "low",
              writeScope: "deny-all",
            }
          : undefined,
    });

    runtime.start();
    try {
      expect(runtime.enqueuePendingRun("security-review").ok).toBe(true);
      await waitUntil(
        () =>
          countWorkflowRuns(workspaceRoot, "security-review") === 1 &&
          !runtime.isBusy(),
        "Timed out waiting for rejected security review",
      );
    } finally {
      await runtime.stop();
      runState.close();
    }

    const securityRunId = readdirSync(join(workspaceRoot, ".kota", "runs")).find(
      (runId) => runId.includes("security-review"),
    );
    expect(securityRunId).toBeDefined();
    const runDir = join(workspaceRoot, ".kota", "runs", securityRunId!);
    const metadata = JSON.parse(
      readFileSync(join(runDir, "metadata.json"), "utf8"),
    ) as { status: string; steps: Array<{ id: string; status: string }> };
    expect(metadata.status).toBe("failed");
    expect(
      metadata.steps.find((step) => step.id === "investigate-candidates"),
    ).toMatchObject({ status: "failed" });
    expect(
      JSON.parse(
        readFileSync(
          join(
            runDir,
            "steps",
            "investigate-candidates.write-scope-violation.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      stepId: "investigate-candidates",
      agentName: "security-reviewer",
      scope: "deny-all",
      violations: [violationPath],
    });
    expect(existsSync(join(workspaceRoot, violationPath))).toBe(false);
  });
});
