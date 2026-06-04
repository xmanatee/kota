import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
  ScopeRegistry,
} from "#core/daemon/scope-registry.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "#core/workflow/trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { progressReviewRequested } from "./events.js";
import {
  applyProgressReviewActions,
  classifyProgressReviewTrigger,
  collectProgressReviewEvidence,
  decodeProgressReviewAgentOutput,
  decodeProgressReviewAgentOutputForEvidence,
  PROGRESS_REVIEW_ARTIFACT,
  type ProgressReviewActionResult,
  type ProgressReviewAgentOutput,
  readTaskStatus,
} from "./progress-review.js";
import progressReviewerWorkflow, { progressReviewOutputSchema } from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
      "#modules/autonomy/commit.js",
    );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
      "#modules/autonomy/shared.js",
    );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

const NOW = new Date("2026-06-04T12:00:00.000Z");

function readFixture(name: string): ProgressReviewAgentOutput {
  return decodeProgressReviewAgentOutput(
    JSON.parse(
      readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf-8"),
    ),
  );
}

function makeProjectDir(label = "progress-reviewer"): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  options: { title?: string; updatedAt?: string; area?: string } = {},
): void {
  const title = options.title ?? id;
  const updatedAt = options.updatedAt ?? NOW.toISOString();
  const area = options.area ?? "autonomy";
  const content = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${state}`,
    "priority: p2",
    `area: ${area}`,
    `summary: ${title} summary`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    "---",
    "",
    "## Problem",
    "",
    "Review fixture problem.",
    "",
    "## Desired Outcome",
    "",
    "Review fixture outcome.",
    "",
    "## Constraints",
    "",
    "- Keep evidence cited.",
    "",
    "## Done When",
    "",
    "- Done.",
    "",
    "## Source / Intent",
    "",
    "Progress reviewer test fixture.",
    "",
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    "- Test fixture.",
    "",
  ].join("\n");
  writeFileSync(join(projectDir, "data", "tasks", state, `${id}.md`), content);
}

function writeInboxEntry(projectDir: string, id: string, title: string): void {
  mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  writeFileSync(
    join(projectDir, "data", "inbox", `${id}.md`),
    `# ${title}\n`,
  );
}

function writeRun(
  projectDir: string,
  id: string,
  workflow: string,
  status: string,
  startedAt: string,
): void {
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify(
      {
        id,
        workflow,
        status,
        startedAt,
        completedAt: startedAt,
        durationMs: 1000,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(runDir, "trigger.json"),
    JSON.stringify({ event: "autonomy.queue.available", payload: {} }, null, 2),
  );
  writeFileSync(
    join(runDir, "run-summary.json"),
    JSON.stringify({ ok: true, workflow }, null, 2),
  );
}

function writeRunArtifactFile(
  projectDir: string,
  runId: string,
  relativePath: string,
  contents: string,
): void {
  const path = join(projectDir, ".kota", "runs", runId, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function gitCommitAll(projectDir: string, message: string, committedAt: string): string {
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: projectDir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: committedAt,
      GIT_COMMITTER_DATE: committedAt,
    },
  });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();
}

function writeApproval(
  projectDir: string,
  id: string,
  status: "approved" | "rejected" | "expired" | "pending",
  createdAt: string,
  resolvedAt?: string,
): void {
  mkdirSync(join(projectDir, ".kota", "approvals"), { recursive: true });
  writeFileSync(
    join(projectDir, ".kota", "approvals", `${id}.json`),
    JSON.stringify(
      {
        id,
        tool: "Bash",
        input: { cmd: "pnpm run test" },
        risk: "moderate",
        reason: "progress review fixture approval",
        source: "workflow",
        createdAt,
        status,
        ...(resolvedAt ? { resolvedAt, approvalNote: "approved for fixture" } : {}),
      },
      null,
      2,
    ),
  );
}

function channelBatchPayload(projectDir: string): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return {
    scopeId,
    projectId: scopeId,
    sourceEventName: inboundSignalReceived.name,
    groupingKey: "channel=slack;sourceId=C123",
    reason: "count",
    count: 2,
    window: {
      firstEventAt: "2026-06-04T11:55:00.000Z",
      lastEventAt: "2026-06-04T11:56:00.000Z",
      flushedAt: NOW.toISOString(),
    },
    inputEvents: [
      {
        event: inboundSignalReceived.name,
        receivedAt: "2026-06-04T11:55:00.000Z",
        payload: {
          scopeId,
          projectId: scopeId,
          provider: "slack",
          channel: "slack",
          accountId: "workspace",
          sourceId: "C123",
          sourceUrl: "https://slack.example/C123",
          externalId: "m1",
          occurredAt: "2026-06-04T11:55:00.000Z",
          receivedAt: "2026-06-04T11:55:00.000Z",
          actor: {
            id: "U1",
            displayName: "Owner",
            trust: "trusted",
            trustReason: "test fixture",
          },
          body: {
            kind: "message",
            format: "plain",
            text: "review this channel scope",
          },
        },
      },
      {
        event: inboundSignalReceived.name,
        receivedAt: "2026-06-04T11:56:00.000Z",
        payload: {
          scopeId,
          projectId: scopeId,
          provider: "slack",
          channel: "slack",
          accountId: "workspace",
          sourceId: "C123",
          sourceUrl: "https://slack.example/C123",
          externalId: "m2",
          occurredAt: "2026-06-04T11:56:00.000Z",
          receivedAt: "2026-06-04T11:56:00.000Z",
          actor: {
            id: "U1",
            displayName: "Owner",
            trust: "trusted",
            trustReason: "test fixture",
          },
          body: {
            kind: "message",
            format: "plain",
            text: "second message",
          },
        },
      },
    ],
    batch: {
      workflow: "progress-reviewer",
      triggerIndex: 4,
      maxBufferSize: 30,
      overflow: "flush-oldest",
      droppedInputCount: 0,
    },
  };
}

async function mockCleanWorktree() {
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  });
}

describe("progress-reviewer workflow", () => {
  const projectDirs: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    await mockCleanWorktree();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModuleEventRegistry();
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function trackProjectDir(label?: string): string {
    const dir = makeProjectDir(label);
    projectDirs.push(dir);
    return dir;
  }

  it("declares schedule, manual, run-count, task-count, and channel batch triggers without a completion self-loop", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register("autonomy", progressReviewRequested);
    moduleEvents.register("inbound-signals", inboundSignalReceived);

    expect(() =>
      validateWorkflowDefinitions([
        registerWorkflowDefinition(
          "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
          progressReviewerWorkflow,
        ),
      ]),
    ).not.toThrow();

    expect(progressReviewerWorkflow.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: progressReviewRequested.name }),
        expect.objectContaining({
          event: "autonomy.progress-review.scheduled",
          schedule: "0 */6 * * *",
        }),
        expect.objectContaining({
          event: "workflow.completed",
          batch: expect.objectContaining({ maxCount: 5 }),
        }),
        expect.objectContaining({
          event: "workflow.build.committed",
          batch: expect.objectContaining({ maxCount: 3 }),
        }),
        expect.objectContaining({
          event: inboundSignalReceived.name,
          batch: expect.objectContaining({ maxCount: 10 }),
        }),
      ]),
    );
  });

  it("writes an explicit no-op artifact for an autonomous coding scope review", async () => {
    const projectDir = trackProjectDir("progress-reviewer-coding");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeTask(projectDir, "done", "task-ship-coding-slice", {
      title: "Ship coding slice",
      updatedAt: "2026-06-04T11:30:00.000Z",
    });
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );

    const harness = new WorkflowTestHarness(progressReviewerWorkflow, {
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      stepMocks: {
        "review-evidence": readFixture("autonomous-coding-review"),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["apply-actions"].status).toBe("success");
    expect(result.steps["write-commit-message"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    const artifactPath = join(projectDir, ".kota", "runs", "harness", PROGRESS_REVIEW_ARTIFACT);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      evidence: { scope: { scopeId: string }; runs: Array<{ workflow: string }>; tasks: Array<{ taskId: string }> };
      review: { verdict: string };
      actions: { createdTaskIds: string[] };
    };
    expect(artifact.evidence.scope.scopeId).toBe(scopeId);
    expect(artifact.evidence.runs.map((run) => run.workflow)).toContain("builder");
    expect(artifact.evidence.tasks.map((task) => task.taskId)).toContain("task-ship-coding-slice");
    expect(artifact.review.verdict).toBe("on-track");
    expect(artifact.actions.createdTaskIds).toHaveLength(0);
  });

  it("classifies the runtime schedule trigger in the review artifact", async () => {
    const projectDir = trackProjectDir("progress-reviewer-schedule");
    writeTask(projectDir, "done", "task-ship-coding-slice", {
      title: "Ship coding slice",
      updatedAt: "2026-06-04T11:30:00.000Z",
    });
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );

    const harness = new WorkflowTestHarness(progressReviewerWorkflow, {
      projectDir,
      trigger: {
        event: "schedule",
        payload: { scheduledAt: "2026-06-04T12:00:00.000Z" },
      },
      stepMocks: {
        "review-evidence": readFixture("autonomous-coding-review"),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    const artifactPath = join(projectDir, ".kota", "runs", "harness", PROGRESS_REVIEW_ARTIFACT);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      evidence: { triggerKind: string; triggerEvent: string };
    };
    expect(artifact.evidence.triggerKind).toBe("schedule");
    expect(artifact.evidence.triggerEvent).toBe("schedule");
  });

  it("creates a deduped follow-up task and owner question for a channel-processing batch review", async () => {
    const projectDir = trackProjectDir("progress-reviewer-channel");
    const payload = channelBatchPayload(projectDir);

    const harness = new WorkflowTestHarness(progressReviewerWorkflow, {
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload,
      },
      stepMocks: {
        "review-evidence": readFixture("channel-processing-review"),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["validate-before-commit"].status).toBe("success");
    const actions = result.steps["apply-actions"].output as ProgressReviewActionResult;
    expect(actions.createdTaskIds).toEqual([
      "task-add-channel-progress-review-routing-fixture",
    ]);
    expect(actions.ownerQuestionIds).toHaveLength(1);
    expect(
      readTaskStatus(projectDir, "task-add-channel-progress-review-routing-fixture"),
    ).toBe("ready");
    expect(existsSync(join(projectDir, ".kota", "owner-questions"))).toBe(true);
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();

    const second = applyProgressReviewActions({
      projectDir,
      runId: "second-run",
      evidence: collectProgressReviewEvidence({
        projectDir,
        trigger: {
          event: WORKFLOW_BATCH_FLUSH_EVENT,
          payload,
        },
        now: NOW,
      }),
      review: readFixture("channel-processing-review"),
    });
    expect(second.createdTaskIds).toHaveLength(0);
    expect(second.ownerQuestionIds).toHaveLength(0);
    expect(second.applied.map((action) => action.kind)).toEqual([
      "skipped-task",
      "skipped-owner-question",
    ]);
  });

  it("classifies batch triggers by their source event", () => {
    const projectDir = trackProjectDir("progress-reviewer-batch-kind");
    const channelBatch = channelBatchPayload(projectDir);
    const runBatch = {
      ...channelBatch,
      sourceEventName: "workflow.completed",
      inputEvents: [
        {
          event: "workflow.completed",
          receivedAt: NOW.toISOString(),
          payload: {
            projectId: channelBatch.projectId,
            workflow: "builder",
            runId: "run-1",
            status: "success",
            triggerEvent: "autonomy.queue.available",
            durationMs: 10,
            definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
            runDir: ".kota/runs/run-1",
            tags: ["monitored"],
          },
        },
      ],
    } satisfies WorkflowBatchFlushPayload;
    const taskBatch = {
      ...channelBatch,
      sourceEventName: "workflow.build.committed",
      inputEvents: [
        {
          event: "workflow.build.committed",
          receivedAt: NOW.toISOString(),
          payload: {
            projectId: channelBatch.projectId,
            runId: "run-1",
            taskId: "task-one",
            commitMessage: "ship task",
            costUsd: null,
            durationMs: 10,
          },
        },
      ],
    } satisfies WorkflowBatchFlushPayload;

    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload: runBatch,
      }),
    ).toBe("run-count");
    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload: taskBatch,
      }),
    ).toBe("task-count");
    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload: channelBatch,
      }),
    ).toBe("message-batch");
  });

  it("keeps directory scope evidence isolated to the selected project directory", () => {
    const projectA = trackProjectDir("progress-reviewer-scope-a");
    const projectB = trackProjectDir("progress-reviewer-scope-b");
    writeTask(projectA, "done", "task-scope-a", { updatedAt: "2026-06-04T11:00:00.000Z" });
    writeTask(projectB, "done", "task-scope-b", { updatedAt: "2026-06-04T11:00:00.000Z" });
    writeRun(projectA, "run-scope-a", "builder", "success", "2026-06-04T11:00:00.000Z");
    writeRun(projectB, "run-scope-b", "builder", "success", "2026-06-04T11:00:00.000Z");
    const scopeA = deriveDirectoryScopeId(projectA);

    const evidence = collectProgressReviewEvidence({
      projectDir: projectA,
      trigger: {
        event: progressReviewRequested.name,
        payload: { scopeId: scopeA, projectId: scopeA, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.scope.scopeId).toBe(scopeA);
    expect(evidence.tasks.map((task) => task.taskId)).toContain("task-scope-a");
    expect(evidence.tasks.map((task) => task.taskId)).not.toContain("task-scope-b");
    expect(evidence.runs.map((run) => run.id)).toContain("run:run-scope-a");
    expect(evidence.runs.map((run) => run.id)).not.toContain("run:run-scope-b");
  });

  it("collects approval outcomes as citeable review evidence", () => {
    const projectDir = trackProjectDir("progress-reviewer-approvals");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeApproval(
      projectDir,
      "a1b2c3d4",
      "approved",
      "2026-06-04T10:30:00.000Z",
      "2026-06-04T11:30:00.000Z",
    );

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.approvals).toEqual([
      expect.objectContaining({
        id: "approval:a1b2c3d4",
        approvalId: "a1b2c3d4",
        status: "approved",
        tool: "Bash",
        resolvedAt: "2026-06-04T11:30:00.000Z",
      }),
    ]);
    expect(evidence.evidence.map((item) => item.id)).toContain(
      "approval:a1b2c3d4",
    );
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        {
          verdict: "on-track",
          summary: "Approval outcome evidence is available to the reviewer.",
          claims: [
            {
              id: "claim-approval-outcome",
              claim: "The reviewed scope includes an approved operator decision.",
              evidenceIds: ["approval:a1b2c3d4"],
              confidence: "high",
            },
          ],
          followUpTasks: [],
          ownerQuestions: [],
        },
        evidence,
      ),
    ).not.toThrow();
  });

  it("collects nested step artifacts as citeable run evidence", () => {
    const projectDir = trackProjectDir("progress-reviewer-step-artifacts");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    writeRunArtifactFile(
      projectDir,
      "builder-success",
      "steps/build.json",
      JSON.stringify({ id: "build", status: "success" }),
    );
    writeRunArtifactFile(
      projectDir,
      "builder-success",
      "steps/build.input.md",
      "# User Prompt\n\nImplement the task.",
    );
    writeRunArtifactFile(
      projectDir,
      "builder-success",
      "steps/build.events.jsonl",
      "{\"type\":\"assistant\",\"text\":\"done\"}\n",
    );
    writeRunArtifactFile(
      projectDir,
      "builder-success",
      "steps/build.tool-telemetry.json",
      JSON.stringify({ summary: "1 tool call", tools: { shell: { calls: 1 } } }),
    );

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artifact:builder-success:steps/build.json",
          file: "steps/build.json",
          path: ".kota/runs/builder-success/steps/build.json",
        }),
        expect.objectContaining({
          id: "artifact:builder-success:steps/build.input.md",
          file: "steps/build.input.md",
        }),
        expect.objectContaining({
          id: "artifact:builder-success:steps/build.events.jsonl",
          file: "steps/build.events.jsonl",
        }),
        expect.objectContaining({
          id: "artifact:builder-success:steps/build.tool-telemetry.json",
          file: "steps/build.tool-telemetry.json",
        }),
      ]),
    );
    expect(evidence.evidence.map((item) => item.id)).toContain(
      "artifact:builder-success:steps/build.input.md",
    );
    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toEqual(
      expect.arrayContaining(["metadata.json", "trigger.json", "workflow.json"]),
    );
  });

  it("collects recent committed file changes when the coding worktree is clean", () => {
    const projectDir = trackProjectDir("progress-reviewer-git-commit");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeFileSync(join(projectDir, "README.md"), "initial\n");
    gitCommitAll(projectDir, "initial fixture", "2026-06-04T10:00:00.000Z");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "coding.ts"), "export const shipped = true;\n");
    const commit = gitCommitAll(
      projectDir,
      "ship coding slice",
      "2026-06-04T11:40:00.000Z",
    );
    const short = commit.slice(0, 12);

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.git).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `git:commit:${short}`,
          gitKind: "commit",
          commit,
          committedAt: "2026-06-04T11:40:00.000Z",
          summary: expect.stringContaining("ship coding slice"),
        }),
        expect.objectContaining({
          id: `git:commit:${short}:file:1`,
          gitKind: "commit-file",
          commit,
          change: "A",
          file: "src/coding.ts",
          path: "src/coding.ts",
        }),
      ]),
    );
    expect(evidence.git.map((item) => item.summary).join("\n")).not.toContain(
      "initial fixture",
    );
  });

  it("collects global scope evidence from every configured directory scope", () => {
    const projectA = trackProjectDir("progress-reviewer-global-a");
    const projectB = trackProjectDir("progress-reviewer-global-b");
    writeTask(projectA, "done", "task-scope-a", { updatedAt: "2026-06-04T11:00:00.000Z" });
    writeTask(projectB, "done", "task-scope-b", { updatedAt: "2026-06-04T11:00:00.000Z" });
    writeRun(projectA, "run-scope-a", "builder", "success", "2026-06-04T11:00:00.000Z");
    writeRun(projectB, "run-scope-b", "builder", "success", "2026-06-04T11:00:00.000Z");
    const scopeA = deriveDirectoryScopeId(projectA);
    const scopeB = deriveDirectoryScopeId(projectB);
    new ScopeRegistry({
      stateDir: join(projectA, ".kota"),
      projects: [
        { projectDir: projectA, displayName: "scope a" },
        { projectDir: projectB, displayName: "scope b" },
      ],
    });

    const evidence = collectProgressReviewEvidence({
      projectDir: projectA,
      trigger: {
        event: progressReviewRequested.name,
        payload: {
          scopeId: GLOBAL_SCOPE_ID,
          projectId: GLOBAL_SCOPE_ID,
          windowMs: 3_600_000,
        },
      },
      now: NOW,
    });

    expect(evidence.scope.scopeId).toBe(GLOBAL_SCOPE_ID);
    expect(evidence.tasks.map((task) => task.taskId)).toEqual(
      expect.arrayContaining(["task-scope-a", "task-scope-b"]),
    );
    expect(evidence.runs.map((run) => run.id)).toEqual(
      expect.arrayContaining([
        `scope:${scopeA}:run:run-scope-a`,
        `scope:${scopeB}:run:run-scope-b`,
      ]),
    );
  });

  it("skips follow-up task creation when a related inbox entry already exists", () => {
    const projectDir = trackProjectDir("progress-reviewer-inbox-dedupe");
    const payload = channelBatchPayload(projectDir);
    writeInboxEntry(
      projectDir,
      "task-add-channel-progress-review-routing-fixture",
      "Add channel progress review routing fixture",
    );

    const result = applyProgressReviewActions({
      projectDir,
      runId: "inbox-dedupe-run",
      evidence: collectProgressReviewEvidence({
        projectDir,
        trigger: {
          event: WORKFLOW_BATCH_FLUSH_EVENT,
          payload,
        },
        now: NOW,
      }),
      review: readFixture("channel-processing-review"),
    });

    expect(result.createdTaskIds).toHaveLength(0);
    expect(result.applied[0]).toMatchObject({
      kind: "skipped-task",
      existingTaskId: "task-add-channel-progress-review-routing-fixture",
      existingState: "inbox",
      existingPath: "data/inbox/task-add-channel-progress-review-routing-fixture.md",
    });
  });

  it("rejects malformed structured review output before actions are applied", () => {
    expect(() =>
      decodeProgressReviewAgentOutput({
        verdict: "needs-steering",
        summary: "Missing arrays.",
      }),
    ).toThrow(/claims/);
    expect(
      validatePayloadSchema(progressReviewOutputSchema, {
        ...readFixture("autonomous-coding-review"),
        extra: "not allowed",
      }),
    ).toContain("unexpected field");
  });

  it("rejects review evidence ids outside the collected packet", () => {
    const projectDir = trackProjectDir("progress-reviewer-evidence-ids");
    const payload = channelBatchPayload(projectDir);
    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload,
      },
      now: NOW,
    });
    const base = readFixture("channel-processing-review");
    const cases: ProgressReviewAgentOutput[] = [
      {
        ...base,
        claims: [{ ...base.claims[0]!, evidenceIds: ["missing:claim"] }],
      },
      {
        ...base,
        followUpTasks: [{ ...base.followUpTasks[0]!, evidenceIds: ["missing:task"] }],
      },
      {
        ...base,
        ownerQuestions: [{ ...base.ownerQuestions[0]!, evidenceIds: ["missing:question"] }],
      },
    ];

    for (const review of cases) {
      expect(() =>
        decodeProgressReviewAgentOutputForEvidence(review, evidence),
      ).toThrow(/unknown evidence id/);
    }
  });
});
