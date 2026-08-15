import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resetModuleEventRegistry } from "#core/events/module-event.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { progressReviewRequested } from "./events.js";
import { PROGRESS_REVIEW_EVIDENCE_ARTIFACT } from "./progress-review.js";
import progressReviewerWorkflow, { agent } from "./workflow.js";
import {
  makeProgressReviewProjectDir,
  registerProgressReviewHarness,
  reviewOutput,
} from "./workflow.test-helpers.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  })),
}));

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
    "#modules/autonomy/commit.js",
  );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
    "#modules/autonomy/shared.js",
  );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

function writeRun(projectDir: string): void {
  const runDir = join(projectDir, ".kota", "runs", "builder-success");
  mkdirSync(runDir, { recursive: true });
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id: "builder-success",
      workflow: "builder",
      status: "success",
      startedAt,
      completedAt: startedAt,
      durationMs: 1_000,
    }),
  );
  writeFileSync(
    join(runDir, "trigger.json"),
    JSON.stringify({ event: "autonomy.queue.available", schemaRef: null, payload: {} }),
  );
  writeFileSync(join(runDir, "run-summary.json"), JSON.stringify({ ok: true }));
}

function writeArtifact(projectDir: string, file: string, contents: string): void {
  const path = join(projectDir, ".kota", "runs", "builder-success", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createRuntime(
  projectDir: string,
  deadLetterQueue: DeadLetterQueueStore,
  workflow: ReturnType<typeof registerWorkflowDefinition>,
): WorkflowRuntime {
  return new WorkflowRuntime({
    bus: new EventBus(),
    projectDir,
    deadLetterQueue,
    idleIntervalMs: 60_000,
    workflows: [workflow],
    resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
  });
}

async function waitUntilIdle(runtime: WorkflowRuntime): Promise<void> {
  await vi.waitFor(() => expect(runtime.isBusy()).toBe(false), {
    timeout: 5_000,
    interval: 10,
  });
}

describe("progress-reviewer runtime redrive", () => {
  let projectDir: string | undefined;
  let unreadableDir: string | undefined;
  let failingRuntime: WorkflowRuntime | undefined;
  let fixedRuntime: WorkflowRuntime | undefined;

  beforeEach(() => vi.clearAllMocks());

  afterEach(async () => {
    await failingRuntime?.stop(100, 100);
    await fixedRuntime?.stop(100, 100);
    if (unreadableDir) chmodSync(unreadableDir, 0o700);
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    resetModuleEventRegistry();
  });

  it("redrives an unreadable artifact failure without a successor dead letter", async ({
    annotate,
    skip,
  }) => {
    if (process.platform === "win32") {
      skip("Windows chmod cannot create the required permission boundary");
    }
    if (process.getuid?.() === 0) skip("root can traverse chmod(000) fixtures");

    projectDir = makeProgressReviewProjectDir("progress-reviewer-unreadable-artifact");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(projectDir);
    writeArtifact(projectDir, "a-before.txt", "before");
    writeArtifact(projectDir, "z-after.txt", "after");
    unreadableDir = join(
      projectDir,
      ".kota",
      "runs",
      "builder-success",
      "m-unreadable",
    );
    mkdirSync(unreadableDir);
    writeFileSync(join(unreadableDir, "hidden.txt"), "hidden");
    chmodSync(unreadableDir, 0o000);

    registerProgressReviewHarness(async () => {
      const output = reviewOutput({
        verdict: "on-track",
        summary: "The redrive retained readable evidence and recorded the exclusion.",
        localScope: {
          claims: [{
            id: "unreadable-artifact-runtime-redrive",
            claim: "The redrive completed without another dead letter.",
            evidenceIds: ["run:builder-success"],
            confidence: "high",
          }],
        },
      });
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        isError: false,
      };
    });

    const definitionPath = "src/modules/autonomy/workflows/progress-reviewer/workflow.ts";
    const runtimeWorkflow = {
      ...progressReviewerWorkflow,
      moduleRoot: process.cwd(),
      triggers: progressReviewerWorkflow.triggers.map((trigger) => ({
        ...trigger,
        cooldownMs: 0,
      })),
    };
    const fixedWorkflow = registerWorkflowDefinition(definitionPath, runtimeWorkflow);
    const failingWorkflow = registerWorkflowDefinition(definitionPath, {
      ...runtimeWorkflow,
      steps: runtimeWorkflow.steps.map((step) =>
        step.type === "code" && step.id === "collect-evidence"
          ? { ...step, run: () => readdirSync(unreadableDir!, { withFileTypes: true }) }
          : step,
      ),
    });
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
    );
    const trigger = {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
    };

    failingRuntime = createRuntime(projectDir, deadLetterQueue, failingWorkflow);
    failingRuntime.start();
    const failedDispatch = failingRuntime.enqueuePendingRun("progress-reviewer", trigger);
    expect(failedDispatch).toMatchObject({ ok: true, runId: expect.any(String) });
    await vi.waitFor(() => {
      expect(failingRuntime?.isBusy()).toBe(false);
      expect(deadLetterQueue.list({ status: "open" })).toHaveLength(1);
    });
    await failingRuntime.stop();

    const failedItem = deadLetterQueue.list({ status: "open" })[0]!;
    expect(failedItem).toMatchObject({
      type: "workflow-dispatch",
      failure: { lastErrorClass: "execution", reason: expect.stringContaining("EACCES") },
      source: { workflowName: "progress-reviewer", failedRunId: failedDispatch.runId },
      redrive: { workflowName: "progress-reviewer" },
    });

    fixedRuntime = createRuntime(projectDir, deadLetterQueue, fixedWorkflow);
    fixedRuntime.start();
    const redrive = fixedRuntime.redriveDeadLetter(
      failedItem.id,
      "artifact traversal now excludes permission-denied directories",
      "original",
    );
    expect(redrive).toMatchObject({ ok: true, runId: expect.any(String) });
    await waitUntilIdle(fixedRuntime);
    await fixedRuntime.stop();

    const runStore = new WorkflowRunStore(projectDir);
    const redrivenRun = runStore.getRun(redrive.runId!);
    expect(redrivenRun).toMatchObject({
      status: "success",
      trigger: { payload: { redriveOf: failedItem.id, retryOf: failedDispatch.runId } },
    });
    const evidence = JSON.parse(
      readFileSync(
        join(projectDir, redrivenRun!.runDir, PROGRESS_REVIEW_EVIDENCE_ARTIFACT),
        "utf-8",
      ),
    ) as { artifacts: Array<{ file: string }>; excluded: string[] };
    const artifactFiles = evidence.artifacts.map((artifact) => artifact.file);
    expect(artifactFiles).toEqual(expect.arrayContaining(["a-before.txt", "z-after.txt"]));
    expect(artifactFiles).not.toContain("m-unreadable/hidden.txt");
    expect(evidence.excluded).toContain(
      "artifacts for builder-success: skipped unreadable directory m-unreadable (EACCES)",
    );
    expect(deadLetterQueue.get(failedItem.id)).toMatchObject({
      status: "redriven",
      redriveAttempts: [{ result: { status: "queued", runId: redrive.runId } }],
    });
    expect(deadLetterQueue.list({ status: "open" })).toEqual([]);
    expect(deadLetterQueue.list()).toHaveLength(1);
    await annotate(
      JSON.stringify({
        failedRun: runStore.getRun(failedDispatch.runId!)?.status,
        failedDeadLetter: { id: failedItem.id, errorCode: "EACCES" },
        redrive: { runId: redrive.runId, status: redrivenRun?.status },
        accessibleArtifacts: artifactFiles,
        exclusions: evidence.excluded.filter((entry) => entry.includes("m-unreadable")),
        openDeadLetters: deadLetterQueue.list({ status: "open" }).length,
      }),
      "application/json",
    );
  });
});
