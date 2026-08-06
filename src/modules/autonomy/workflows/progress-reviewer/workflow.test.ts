import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
  createWorkflowDispatchDeadLetter,
  DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
  ScopeRegistry,
} from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { getPreset, SHIPPED_DEFAULT_PRESET_ID } from "#core/model/preset.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step.js";
import { safeJsonStringify } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
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
  compactProgressReviewEvidenceForAgent,
  decodeProgressReviewAgentOutput,
  decodeProgressReviewAgentOutputForEvidence,
  PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
  PROGRESS_REVIEW_ARTIFACT,
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
  PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH,
  PROGRESS_REVIEW_MAX_ARTIFACTS,
  PROGRESS_REVIEW_MAX_RUNS,
  PROGRESS_REVIEW_SCHEDULE_EVENT,
  type ProgressReviewActionResult,
  type ProgressReviewAgentEvidencePacket,
  type ProgressReviewAgentOutput,
  readTaskStatus,
} from "./progress-review.js";

const TEST_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);

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
    commitWorkflowChanges: vi.fn(() => ({
      committed: true,
      committedPaths: ["data/tasks/ready/task-follow-up.md"],
      daemonRestartRequired: false,
    })),
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

type ReviewFindingGroupInput = Partial<
  ProgressReviewAgentOutput["findings"]["localScope"]
>;

function reviewOutput(args: {
  verdict: ProgressReviewAgentOutput["verdict"];
  summary: string;
  crossScope?: ReviewFindingGroupInput;
  localScope?: ReviewFindingGroupInput;
  ownerQuestions?: ProgressReviewAgentOutput["ownerQuestions"];
}): ProgressReviewAgentOutput {
  return {
    verdict: args.verdict,
    summary: args.summary,
    findings: {
      crossScope: {
        claims: [],
        followUpTasks: [],
        ...args.crossScope,
      },
      localScope: {
        claims: [],
        followUpTasks: [],
        ...args.localScope,
      },
    },
    ownerQuestions: args.ownerQuestions ?? [],
  };
}

function makeProjectDir(label = "progress-reviewer"): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `kota-${label}-`)));
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
  options: {
    title?: string;
    updatedAt?: string;
    area?: string;
    taskClass?: "Product" | "Safety" | "Platform" | "Meta";
    acceptanceEvidence?: string;
    sourceIntent?: string;
  } = {},
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
    ...(options.taskClass ? [`task_class: ${options.taskClass}`] : []),
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
    options.sourceIntent ?? "Progress reviewer test fixture.",
    "",
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    options.acceptanceEvidence ?? "- Test fixture.",
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
    JSON.stringify({ event: "autonomy.queue.available", schemaRef: null, payload: {} }, null, 2),
  );
  writeFileSync(
    join(runDir, "run-summary.json"),
    JSON.stringify({ ok: true, workflow }, null, 2),
  );
}

function writePendingWorkflowRun(
  projectDir: string,
  pendingRun: {
    runId: string;
    workflowName: string;
    triggerEvent: string;
    enqueuedAt: string;
    notBeforeAt?: string;
    payload?: Record<string, unknown>;
  },
): void {
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  writeFileSync(
    join(projectDir, ".kota", "workflow-state.json"),
    JSON.stringify(
      {
        completedRuns: 0,
        pendingRuns: [
          {
            runId: pendingRun.runId,
            workflowName: pendingRun.workflowName,
            trigger: {
              event: pendingRun.triggerEvent,
              schemaRef: null,
              payload: pendingRun.payload ?? {},
            },
            enqueuedAtMs: Date.parse(pendingRun.enqueuedAt),
            notBeforeMs: Date.parse(pendingRun.notBeforeAt ?? pendingRun.enqueuedAt),
          },
        ],
        workflows: {},
      },
      null,
      2,
    ),
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
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
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
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
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

function runCountBatchPayload(projectDir: string, runId: string): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return {
    scopeId,
    projectId: scopeId,
    sourceEventName: "workflow.completed",
    groupingKey: `projectId=${scopeId}`,
    reason: "count",
    count: 1,
    window: {
      firstEventAt: "2026-06-04T11:59:00.000Z",
      lastEventAt: "2026-06-04T11:59:00.000Z",
      flushedAt: NOW.toISOString(),
    },
    inputEvents: [
      {
        event: "workflow.completed",
        schemaRef: null,
        receivedAt: "2026-06-04T11:59:00.000Z",
        payload: {
          scopeId,
          projectId: scopeId,
          workflow: "builder",
          runId,
          status: "success",
          triggerEvent: "autonomy.queue.available",
          durationMs: 1000,
          definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
          runDir: `.kota/runs/${runId}`,
          tags: ["monitored"],
        },
      },
    ],
    batch: {
      workflow: "progress-reviewer",
      triggerIndex: 2,
      maxBufferSize: 20,
      overflow: "flush-oldest",
      droppedInputCount: 0,
    },
  };
}

function registerProgressReviewHarness(run: AgentHarness["run"]): void {
  registerAgentHarness({
    name: TEST_PRESET.harness,
    description: "progress-reviewer workflow test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

function compileProgressReviewerWorkflow() {
  return validateWorkflowDefinitions([
    registerWorkflowDefinition(
      "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
      progressReviewerWorkflow,
    ),
  ], undefined, { defaultAgentHarness: TEST_PRESET.harness, preset: TEST_PRESET })[0]!;
}

function parseReviewInputFromAgentPrompt(
  options: AgentHarnessRunOptions,
): ProgressReviewAgentEvidencePacket {
  const match = options.prompt.match(
    /<step id="prepare-review-input">\n([\s\S]*?)\n<\/step>/,
  );
  if (!match) {
    throw new Error("expected prepare-review-input to be exposed to the agent");
  }
  if (options.prompt.includes('<step id="collect-evidence">')) {
    throw new Error("collect-evidence must not be exposed to the agent");
  }
  return JSON.parse(match[1]!) as ProgressReviewAgentEvidencePacket;
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

async function mockDirtyWorktree() {
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: true,
    trackedDirty: true,
    entries: ["M src/active-builder-change.ts"],
    fingerprint: "src/active-builder-change.ts:M",
    summary: "M src/active-builder-change.ts",
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

  it("keeps native capable-tier execution and fenced JSON extraction aligned", () => {
    const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf-8");
    const definition = compileProgressReviewerWorkflow();
    const reviewStep = definition.steps.find((step) => step.id === "review-evidence");

    expect(definition.defaultAutonomyMode).toBe("autonomous");
    expect(reviewStep).toEqual(
      expect.objectContaining({
        type: "agent",
        outputFormat: "json",
      }),
    );
    expect(prompt).toContain("fenced JSON");
    expect(prompt).not.toContain("Return exactly one structured JSON object");
  });

  it("skips review-evidence while tracked worktree changes are present", async () => {
    await mockDirtyWorktree();
    const projectDir = trackProjectDir("progress-reviewer-dirty");
    const scopeId = deriveDirectoryScopeId(projectDir);
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
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-worktree"].output).toEqual({ dirty: true });
    expect(result.steps["review-evidence"].status).toBe("skipped");
    expect(result.steps["write-artifact"].status).toBe("skipped");
  });

  it("declares schedule, manual, run-count, and task-count triggers without direct inbound-signal triggers", () => {
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register("autonomy", progressReviewRequested);

    expect(() => compileProgressReviewerWorkflow()).not.toThrow();

    expect(progressReviewerWorkflow.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: progressReviewRequested.name }),
        expect.objectContaining({
          event: PROGRESS_REVIEW_SCHEDULE_EVENT,
          schedule: "0 */6 * * *",
          runOn: "default-scope",
          payload: { scopeId: GLOBAL_SCOPE_ID },
        }),
        expect.objectContaining({
          event: "workflow.completed",
          batch: expect.objectContaining({ maxCount: 5 }),
        }),
        expect.objectContaining({
          event: "workflow.build.committed",
          batch: expect.objectContaining({ maxCount: 3 }),
        }),
      ]),
    );
    expect(progressReviewerWorkflow.triggers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: inboundSignalReceived.name }),
      ]),
    );
    expect(
      progressReviewerWorkflow.steps.find((step) => step.id === "collect-evidence"),
    ).toEqual(expect.not.objectContaining({ exposeOutputToAgent: true }));
    expect(
      progressReviewerWorkflow.steps.find((step) => step.id === "prepare-review-input"),
    ).toEqual(expect.objectContaining({ exposeOutputToAgent: true }));
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
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
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
      reviewInput: { evidence: Array<{ id: string }> };
      review: { verdict: string };
      actions: { createdTaskIds: string[] };
    };
    expect(artifact.evidence.scope.scopeId).toBe(scopeId);
    expect(artifact.evidence.runs.map((run) => run.workflow)).toContain("builder");
    expect(artifact.evidence.tasks.map((task) => task.taskId)).toContain("task-ship-coding-slice");
    expect(artifact.reviewInput.evidence.map((item) => item.id)).toContain(
      "run:builder-success",
    );
    expect(artifact.review.verdict).toBe("on-track");
    expect(artifact.actions.createdTaskIds).toHaveLength(0);
  });

  it("cleans native harness scratch artifacts before write-scope enforcement", async () => {
    const projectDir = trackProjectDir("progress-reviewer-scratch-cleanup");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    registerProgressReviewHarness(async () => {
      mkdirSync(join(projectDir, ".playwright-mcp"), { recursive: true });
      writeFileSync(
        join(projectDir, ".playwright-mcp", "console-2026-06-24T15-31-34-323Z.log"),
        "browser console scratch\n",
      );
      writeFileSync(
        join(projectDir, ".playwright-mcp", "page-2026-06-24T15-31-36-771Z.yml"),
        "browser page scratch\n",
      );
      writeFileSync(join(projectDir, "x-article-body.txt"), "article scratch\n");
      const output = reviewOutput({
        verdict: "on-track",
        summary: "The reviewer returned schema-valid JSON after native scratch cleanup.",
        localScope: {
          claims: [
            {
              id: "scratch-cleanup-review-evidence-json",
              claim:
                "The review-evidence step completed with schema-valid JSON while native harness scratch files were cleaned before write-scope enforcement.",
              evidenceIds: ["run:builder-success"],
              confidence: "high",
            },
          ],
        },
      });
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        isError: false,
      };
    });

    const { promise } = executeWorkflowRun(
      compileProgressReviewerWorkflow(),
      {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      {
        projectDir,
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        runId: "scratch-cleanup-review",
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(existsSync(join(projectDir, ".playwright-mcp"))).toBe(false);
    expect(existsSync(join(projectDir, "x-article-body.txt"))).toBe(false);
    expect(
      existsSync(
        join(
          projectDir,
          ".kota",
          "runs",
          "scratch-cleanup-review",
          "steps",
          "review-evidence.write-scope-violation.json",
        ),
      ),
    ).toBe(false);
    const reviewResult = result.metadata.steps.find(
      (step) => step.id === "review-evidence",
    );
    expect(reviewResult).toEqual(
      expect.objectContaining({
        status: "success",
        output: expect.objectContaining({ verdict: "on-track" }),
      }),
    );
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
        schemaRef: null, payload: { scheduledAt: "2026-06-04T12:00:00.000Z" },
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

  it("writes a global review artifact for the default-scope scheduled trigger", async () => {
    const projectA = trackProjectDir("progress-reviewer-scheduled-global-a");
    const projectB = trackProjectDir("progress-reviewer-scheduled-global-b");
    writeTask(projectA, "done", "task-scheduled-scope-a", {
      updatedAt: "2026-06-04T11:30:00.000Z",
    });
    writeTask(projectB, "done", "task-scheduled-scope-b", {
      updatedAt: "2026-06-04T11:25:00.000Z",
    });
    writeRun(
      projectA,
      "scheduled-run-scope-a",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    writeRun(
      projectB,
      "scheduled-run-scope-b",
      "builder",
      "success",
      "2026-06-04T11:15:00.000Z",
    );
    const scopeA = deriveDirectoryScopeId(projectA);
    const scopeB = deriveDirectoryScopeId(projectB);
    new ScopeRegistry({
      stateDir: join(projectA, ".kota"),
      projects: [
        { projectDir: projectA, displayName: "scope a" },
        { projectDir: projectB, displayName: "scope b" },
      ],
    });

    const harness = new WorkflowTestHarness(progressReviewerWorkflow, {
      projectDir: projectA,
      trigger: {
        event: PROGRESS_REVIEW_SCHEDULE_EVENT,
        schemaRef: null,
        payload: { scheduledAt: NOW.toISOString(), scopeId: GLOBAL_SCOPE_ID },
      },
      stepMocks: {
        "review-evidence": reviewOutput({
          verdict: "on-track",
          summary: "Scheduled global review includes both configured scopes.",
          crossScope: {
            claims: [
              {
                id: "claim-global-scheduled",
                claim: "The scheduled global review includes evidence from both configured scopes.",
                evidenceIds: [
                  `scope:${scopeA}:run:scheduled-run-scope-a`,
                  `scope:${scopeB}:task:task-scheduled-scope-b`,
                ],
                confidence: "high",
              },
            ],
          },
        }),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    const artifactPath = join(projectA, ".kota", "runs", "harness", PROGRESS_REVIEW_ARTIFACT);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      evidence: {
        triggerKind: string;
        triggerEvent: string;
        scope: { kind: string; scopeId: string };
        window: { startedAt: string; endedAt: string; maxAgeMs: number };
        scopes: Array<{
          scope: {
            kind: string;
            scopeId: string;
            displayName: string;
            directoryRoot?: string;
          };
          window: { startedAt: string; endedAt: string; maxAgeMs: number };
          excluded: string[];
          runs: Array<{ id: string }>;
          tasks: Array<{ taskId: string }>;
        }>;
        runs: Array<{ id: string }>;
        tasks: Array<{ taskId: string; summary: string }>;
      };
      reviewInput: {
        scopes: Array<{
          scope: { scopeId: string };
          window: { startedAt: string; endedAt: string; maxAgeMs: number };
          excluded: string[];
        }>;
        evidence: Array<{ id: string; summary: string }>;
      };
      review: {
        findings: {
          crossScope: { claims: Array<{ evidenceIds: string[] }> };
          localScope: { claims: unknown[] };
        };
      };
    };
    expect(artifact.evidence.triggerKind).toBe("schedule");
    expect(artifact.evidence.triggerEvent).toBe(PROGRESS_REVIEW_SCHEDULE_EVENT);
    expect(artifact.evidence.scope).toMatchObject({
      kind: "global",
      scopeId: GLOBAL_SCOPE_ID,
    });
    expect(artifact.evidence.tasks.map((task) => task.taskId)).toEqual(
      expect.arrayContaining(["task-scheduled-scope-a", "task-scheduled-scope-b"]),
    );
    expect(artifact.evidence.runs.map((run) => run.id)).toEqual(
      expect.arrayContaining([
        `scope:${scopeA}:run:scheduled-run-scope-a`,
        `scope:${scopeB}:run:scheduled-run-scope-b`,
      ]),
    );
    expect(artifact.evidence.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: expect.objectContaining({
            kind: "directory",
            scopeId: scopeA,
            displayName: "scope a",
            directoryRoot: projectA,
          }),
          window: artifact.evidence.window,
          excluded: [],
          runs: expect.arrayContaining([
            expect.objectContaining({ id: `scope:${scopeA}:run:scheduled-run-scope-a` }),
          ]),
          tasks: expect.arrayContaining([
            expect.objectContaining({ taskId: "task-scheduled-scope-a" }),
          ]),
        }),
        expect.objectContaining({
          scope: expect.objectContaining({
            kind: "directory",
            scopeId: scopeB,
            displayName: "scope b",
            directoryRoot: projectB,
          }),
          window: artifact.evidence.window,
          excluded: [],
          runs: expect.arrayContaining([
            expect.objectContaining({ id: `scope:${scopeB}:run:scheduled-run-scope-b` }),
          ]),
          tasks: expect.arrayContaining([
            expect.objectContaining({ taskId: "task-scheduled-scope-b" }),
          ]),
        }),
      ]),
    );
    expect(artifact.reviewInput.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: expect.objectContaining({ scopeId: scopeA }),
          window: artifact.evidence.window,
          excluded: [],
        }),
        expect.objectContaining({
          scope: expect.objectContaining({ scopeId: scopeB }),
          window: artifact.evidence.window,
          excluded: [],
        }),
      ]),
    );
    expect(artifact.reviewInput.evidence.map((item) => item.summary)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[scope a]"),
        expect.stringContaining("[scope b]"),
      ]),
    );
    expect(artifact.review.findings.crossScope.claims[0]?.evidenceIds).toEqual([
      `scope:${scopeA}:run:scheduled-run-scope-a`,
      `scope:${scopeB}:task:task-scheduled-scope-b`,
    ]);
    expect(artifact.review.findings.localScope.claims).toHaveLength(0);
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
          schemaRef: null,
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
          schemaRef: null,
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
          schemaRef: null,
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
        schemaRef: null, payload: runBatch,
      }),
    ).toBe("run-count");
    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null, payload: taskBatch,
      }),
    ).toBe("task-count");
    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null, payload: channelBatch,
      }),
    ).toBe("message-batch");
  });

  it("keeps workflow batch run ids citeable when recent runs are truncated", () => {
    const projectDir = trackProjectDir("progress-reviewer-batch-run-evidence");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "batched-builder-run",
      "builder",
      "success",
      "2026-06-04T10:00:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_RUNS; index += 1) {
      writeRun(
        projectDir,
        `newer-run-${String(index).padStart(2, "0")}`,
        "workflow-failure-escalator",
        "success",
        `2026-06-04T11:${String(index).padStart(2, "0")}:00.000Z`,
      );
    }
    const payload: WorkflowBatchFlushPayload = {
      scopeId,
      projectId: scopeId,
      sourceEventName: "workflow.completed",
      groupingKey: `projectId=${scopeId}`,
      reason: "count",
      count: 1,
      window: {
        firstEventAt: "2026-06-04T11:59:00.000Z",
        lastEventAt: "2026-06-04T11:59:00.000Z",
        flushedAt: NOW.toISOString(),
      },
      inputEvents: [
        {
          event: "workflow.completed",
          schemaRef: null,
          receivedAt: "2026-06-04T11:59:00.000Z",
          payload: {
            scopeId,
            projectId: scopeId,
            workflow: "builder",
            runId: "batched-builder-run",
            status: "success",
            triggerEvent: "runtime.recovered",
            durationMs: 1000,
            definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
            runDir: ".kota/runs/batched-builder-run",
            tags: ["monitored"],
          },
        },
      ],
      batch: {
        workflow: "progress-reviewer",
        triggerIndex: 2,
        maxBufferSize: 20,
        overflow: "flush-oldest",
        droppedInputCount: 0,
      },
    };

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      now: NOW,
    });

    expect(evidence.runs).toHaveLength(PROGRESS_REVIEW_MAX_RUNS);
    expect(evidence.runs[0]).toEqual(
      expect.objectContaining({
        id: "run:batched-builder-run",
        workflow: "builder",
        triggerEvent: "autonomy.queue.available",
      }),
    );
    expect(evidence.evidence.map((item) => item.id)).toContain(
      "run:batched-builder-run",
    );
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "on-track",
          summary: "The batched workflow run is citeable.",
          localScope: {
            claims: [
              {
                id: "batch-run-citeable",
                claim: "The workflow batch included the builder recovery run.",
                evidenceIds: ["run:batched-builder-run"],
                confidence: "high",
              },
            ],
          },
        }),
        evidence,
      ),
    ).not.toThrow();
  });

  it("builds a bounded review-agent packet and validates only exposed ids", () => {
    const projectDir = trackProjectDir("progress-reviewer-agent-packet");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "batched-builder-run",
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        projectDir,
        "batched-builder-run",
        `artifact-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index }),
      );
    }
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    const deadLetter = createWorkflowDispatchDeadLetter({
      store: deadLetterQueue,
      scopeId,
      workflowName: "progress-reviewer",
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId },
      },
      reason: 'Step "review-evidence" timed out after 1800000ms',
      errorClass: "execution",
    });
    const payload: WorkflowBatchFlushPayload = {
      scopeId,
      projectId: scopeId,
      sourceEventName: "workflow.completed",
      groupingKey: `projectId=${scopeId}`,
      reason: "count",
      count: 1,
      window: {
        firstEventAt: "2026-06-04T11:59:00.000Z",
        lastEventAt: "2026-06-04T11:59:00.000Z",
        flushedAt: NOW.toISOString(),
      },
      inputEvents: [
        {
          event: "workflow.completed",
          schemaRef: null,
          receivedAt: "2026-06-04T11:59:00.000Z",
          payload: {
            scopeId,
            projectId: scopeId,
            workflow: "builder",
            runId: "batched-builder-run",
            status: "success",
            triggerEvent: "autonomy.queue.available",
            durationMs: 1000,
            definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
            runDir: ".kota/runs/batched-builder-run",
            tags: ["monitored"],
          },
        },
      ],
      batch: {
        workflow: "progress-reviewer",
        triggerIndex: 2,
        maxBufferSize: 20,
        overflow: "flush-oldest",
        droppedInputCount: 0,
      },
    };

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      now: NOW,
    });
    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);
    const exposedIds = new Set(reviewInput.evidence.map((item) => item.id));

    expect(reviewInput.triggerKind).toBe("run-count");
    expect(reviewInput.counts.artifacts).toBe(PROGRESS_REVIEW_MAX_ARTIFACTS);
    expect(reviewInput.evidence.length).toBeLessThanOrEqual(
      PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
    );
    expect(reviewInput.evidence.length).toBeLessThan(evidence.evidence.length);
    expect(Buffer.byteLength(JSON.stringify(reviewInput), "utf-8")).toBeLessThan(
      Buffer.byteLength(JSON.stringify(evidence), "utf-8"),
    );
    expect(exposedIds).toContain("run:batched-builder-run");
    expect(exposedIds).toContain(`dead-letter:${deadLetter.id}`);
    expect("runs" in reviewInput).toBe(false);
    expect("artifacts" in reviewInput).toBe(false);
    expect(reviewInput.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining("agent evidence packet: omitted"),
      ]),
    );

    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "on-track",
          summary: "The exposed packet is bounded and citeable.",
          localScope: {
            claims: [
              {
                id: "claim-bounded-packet",
                claim: "The run-count packet kept the batched run citeable.",
                evidenceIds: ["run:batched-builder-run"],
                confidence: "high",
              },
            ],
          },
        }),
        reviewInput,
      ),
    ).not.toThrow();
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "on-track",
          summary: "Unknown ids should not be accepted.",
          localScope: {
            claims: [
              {
                id: "claim-unknown-id",
                claim: "The review cited an id outside the packet.",
                evidenceIds: ["run:not-in-packet"],
                confidence: "low",
              },
            ],
          },
        }),
        reviewInput,
      ),
    ).toThrow(/unknown evidence id/);
  });

  it("keeps high-signal run artifacts in the bounded review-agent packet", () => {
    const projectDir = trackProjectDir("progress-reviewer-high-signal-artifacts");
    const noiseRunId = "aaaa-blocked-promoter-run";
    const builderRunId = "zzzz-builder-run";
    writeRun(
      projectDir,
      noiseRunId,
      "blocked-promoter",
      "success",
      "2026-06-04T10:59:00.000Z",
    );
    writeRun(
      projectDir,
      builderRunId,
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    const noiseArtifactCount = 24;
    for (let index = 0; index < noiseArtifactCount; index += 1) {
      writeRunArtifactFile(
        projectDir,
        noiseRunId,
        `steps/noise-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index }),
      );
    }
    for (const file of [
      "acceptance-evidence.txt",
      "critic-review.json",
      "evaluator-calibration.json",
    ]) {
      writeRunArtifactFile(
        projectDir,
        builderRunId,
        file,
        JSON.stringify({ file }),
      );
    }
    writeRunArtifactFile(
      projectDir,
      builderRunId,
      "steps/build.json",
      JSON.stringify({ id: "build", status: "success" }),
    );

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload: runCountBatchPayload(projectDir, builderRunId),
      },
      now: NOW,
    });
    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);
    const exposedIds = reviewInput.evidence.map((item) => item.id);

    expect(exposedIds).toEqual(
      expect.arrayContaining([
        `artifact:${builderRunId}:acceptance-evidence.txt`,
        `artifact:${builderRunId}:critic-review.json`,
        `artifact:${builderRunId}:evaluator-calibration.json`,
      ]),
    );
    expect(exposedIds).not.toContain(
      `artifact:${noiseRunId}:steps/noise-${String(noiseArtifactCount - 1).padStart(2, "0")}.json`,
    );
    expect(evidence.evidence.length).toBeGreaterThan(reviewInput.evidence.length);
  });

  it("normalizes compacted child evidence ids to exposed parent ids", () => {
    const evidence = {
      evidence: [
        {
          id: "git:commit:abc123def456",
          kind: "git" as const,
          summary: "commit abc123def456: Refactor review evidence",
        },
        {
          id: "run:builder-run-001",
          kind: "run" as const,
          summary: "builder success (builder-run-001)",
        },
        {
          id: "run:builder-run-003",
          kind: "run" as const,
          summary: "builder success (builder-run-003)",
        },
        {
          id: "event:1",
          kind: "event" as const,
          summary:
            'workflow.build.committed at 2026-06-04T11:59:00.000Z: {"runId":"builder-run-002","taskId":"task-a"}',
        },
      ],
    };

    const normalized = decodeProgressReviewAgentOutputForEvidence(
      reviewOutput({
        verdict: "on-track",
        summary: "Compacted child ids are represented by exposed parents.",
        localScope: {
          claims: [
            {
              id: "compacted-child-ids",
              claim:
                "A reviewer inspected compacted child evidence but cited child ids.",
              evidenceIds: [
                "git:commit:abc123def456:file:3",
                "artifact:builder-run-001:critic-review.json",
                "run:builder-run-002",
                "run:builder-run-003",
                "event:evtj-000000000123",
              ],
              confidence: "medium",
            },
          ],
        },
      }),
      evidence,
    );

    expect(normalized.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "git:commit:abc123def456",
      "run:builder-run-001",
      "event:1",
      "run:builder-run-003",
    ]);
    const normalizedFromFullEvidence = decodeProgressReviewAgentOutputForEvidence(
      reviewOutput({
        verdict: "on-track",
        summary: "Full evidence ids are allowed when inspected exactly.",
        localScope: {
          claims: [
            {
              id: "full-evidence-ids",
              claim:
                "A reviewer inspected the full evidence artifact and cited exact omitted ids.",
              evidenceIds: [
                "event:evtj-000000000999",
                "dead-letter:dlq-00000000-0000-4000-8000-000000000001",
              ],
              confidence: "medium",
            },
          ],
        },
      }),
      evidence,
      {
        evidence: [
          ...evidence.evidence,
          {
            id: "event:evtj-000000000999",
            kind: "event" as const,
            summary: "workflow.completed at 2026-06-04T11:59:00.000Z",
          },
          {
            id: "dead-letter:dlq-00000000-0000-4000-8000-000000000001",
            kind: "dead-letter" as const,
            summary: "open workflow-dispatch for progress-reviewer",
          },
        ],
      },
    );
    expect(normalizedFromFullEvidence.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "event:evtj-000000000999",
      "dead-letter:dlq-00000000-0000-4000-8000-000000000001",
    ]);
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "on-track",
          summary: "Unanchored compacted event ids are still unknown.",
          localScope: {
            claims: [
              {
                id: "unanchored-event-id",
                claim: "A reviewer cited an event id outside the packet.",
                evidenceIds: ["event:evtj-000000000999"],
                confidence: "low",
              },
            ],
          },
        }),
        evidence,
      ),
    ).toThrow(/unknown evidence id/);
  });

  it("reports task_class distribution and Product operator-journey risks", () => {
    const projectDir = trackProjectDir("progress-reviewer-task-class-risk");
    writeTask(projectDir, "done", "task-product-tests-only", {
      title: "Improve dashboard empty state",
      area: "client",
      taskClass: "Product",
      acceptanceEvidence: "- Unit tests pass.",
    });
    writeTask(projectDir, "done", "task-safety-check", {
      title: "Tighten approval guard",
      area: "modules",
      taskClass: "Safety",
    });
    writeTask(projectDir, "done", "task-platform-api", {
      title: "Add setup contract field",
      area: "modules",
      taskClass: "Platform",
    });
    writeTask(projectDir, "done", "task-meta-with-link", {
      title: "Improve evaluator calibration",
      area: "autonomy",
      taskClass: "Meta",
    });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      },
      now: NOW,
    });
    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);

    expect(reviewInput.counts.taskClasses).toEqual([
      { taskClass: "Safety", count: 1 },
      { taskClass: "Product", count: 1 },
      { taskClass: "Platform", count: 1 },
      { taskClass: "Meta", count: 1 },
    ]);
    expect(reviewInput.operatorJourneyRisks).toEqual([
      expect.objectContaining({
        taskId: "task-product-tests-only",
        evidenceId: "task:task-product-tests-only",
      }),
    ]);
    expect(reviewInput.operatorJourneyRisks[0]?.reason).toContain(
      "Product task moved to done without transcript",
    );
  });

  it("classifies workflow-generated follow-up tasks in evidence and frontmatter", () => {
    const projectDir = trackProjectDir("progress-reviewer-generated-task-class");
    writeTask(projectDir, "done", "task-security-generated", {
      title: "Security review: tighten approval replay",
      area: "security",
      sourceIntent: "Created by security-review workflow run security-review-run.",
    });
    writeTask(projectDir, "done", "task-platform-generated", {
      title: "Add observability evidence for platform DLQ cleanup",
      area: "platform",
      sourceIntent: "Created by progress-reviewer workflow run progress-review-run.",
    });
    writeTask(projectDir, "done", "task-clear-stale-builder-dlq-items-after-repair-merge", {
      title: "Clear stale builder DLQ items after repair merge",
      area: "platform",
      sourceIntent: "Follow-up from `task-resolve-current-builder-workflow-dead-letters`.",
    });
    writeTask(projectDir, "done", "task-meta-generated", {
      title: "Clear runtime repair reviewer drift",
      area: "autonomy",
      sourceIntent: "Created by progress-reviewer workflow run progress-review-run.",
    });
    execFileSync("git", [
      "add",
      "data/tasks/done/task-security-generated.md",
      "data/tasks/done/task-platform-generated.md",
      "data/tasks/done/task-clear-stale-builder-dlq-items-after-repair-merge.md",
      "data/tasks/done/task-meta-generated.md",
    ], { cwd: projectDir });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.taskClassDistribution).toEqual([
      { taskClass: "Safety", count: 1 },
      { taskClass: "Platform", count: 2 },
      { taskClass: "Meta", count: 1 },
    ]);
    expect(
      evidence.tasks.find((task) => task.taskId === "task-security-generated")?.taskClass,
    ).toBe("Safety");
    expect(
      evidence.tasks.find((task) => task.taskId === "task-platform-generated")?.taskClass,
    ).toBe("Platform");
    expect(
      evidence.tasks.find(
        (task) => task.taskId === "task-clear-stale-builder-dlq-items-after-repair-merge",
      )?.taskClass,
    ).toBe("Platform");
    expect(evidence.tasks.find((task) => task.taskId === "task-meta-generated")?.taskClass)
      .toBe("Meta");

    const actionResult = applyProgressReviewActions({
      projectDir,
      runId: "progress-review-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "Generated follow-up tasks need deterministic task_class metadata.",
        localScope: {
          followUpTasks: [
            {
              title: "Security generated follow-up",
              summary: "Security finding follow-up should enter the Safety balance.",
              priority: "p2",
              area: "security",
              evidenceIds: ["task:task-security-generated"],
              acceptanceEvidence: "Generated task frontmatter records task_class: Safety.",
            },
            {
              title: "Platform generated follow-up",
              summary: "Platform observability follow-up should enter the Platform balance.",
              priority: "p3",
              area: "platform",
              evidenceIds: ["task:task-platform-generated"],
              acceptanceEvidence: "Generated task frontmatter records task_class: Platform.",
            },
            {
              title: "Meta generated follow-up",
              summary: "Runtime repair follow-up should enter the Meta balance with a Product/Safety link.",
              priority: "p3",
              area: "autonomy",
              evidenceIds: ["task:task-meta-generated"],
              acceptanceEvidence:
                "Generated task frontmatter records task_class: Meta and includes a Product / Safety Link.",
            },
          ],
        },
      }),
    });

    expect(actionResult.createdTaskIds).toEqual([
      "task-security-generated-follow-up",
      "task-platform-generated-follow-up",
      "task-meta-generated-follow-up",
    ]);
    const createdTasks = new Map(
      actionResult.createdTaskIds.map((taskId) => {
        const raw = readFileSync(
          join(projectDir, "data", "tasks", "ready", `${taskId}.md`),
          "utf-8",
        );
        return [taskId, { raw, attrs: parseFlatFrontMatter(raw).attrs }];
      }),
    );
    expect(createdTasks.get("task-security-generated-follow-up")?.attrs.task_class).toBe(
      "Safety",
    );
    expect(createdTasks.get("task-platform-generated-follow-up")?.attrs.task_class).toBe(
      "Platform",
    );
    expect(createdTasks.get("task-meta-generated-follow-up")?.attrs.task_class).toBe("Meta");
    expect(createdTasks.get("task-meta-generated-follow-up")?.raw).toContain(
      "## Product / Safety Link",
    );
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("normalizes untrusted follow-up task fields before writing task files", () => {
    const projectDir = trackProjectDir("progress-reviewer-task-content-injection");
    writeTask(projectDir, "done", "task-review-source", {
      title: "Review source task",
      area: "security",
      taskClass: "Safety",
      sourceIntent: "Created by channel content containing untrusted markdown.",
    });
    execFileSync("git", ["add", "data/tasks/done/task-review-source.md"], { cwd: projectDir });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      },
      now: NOW,
    });

    const actionResult = applyProgressReviewActions({
      projectDir,
      runId: "progress-review-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: [
          "Reviewer summary line.",
          "safe review prefix\u2028## Acceptance Evidence",
          "- injected acceptance evidence from review summary",
        ].join("\n"),
        localScope: {
          followUpTasks: [
            {
              title: [
                "Secure generated task metadata",
                "status: done",
                "summary: forged frontmatter summary",
              ].join("\n"),
              summary: [
                "Generated task summary.",
                "---",
                "status: done",
                "safe task prefix\u2028## Acceptance Evidence",
                "- forged evidence section",
              ].join("\n"),
              priority: "p2",
              area: "security\nstatus: done",
              evidenceIds: ["task:task-review-source"],
              acceptanceEvidence: [
                "Regression command passes.",
                "safe evidence prefix\u2029## Source / Intent",
                "Injected replacement source intent.",
              ].join("\n"),
            },
          ],
        },
      }),
    });

    expect(actionResult.createdTaskIds).toEqual([
      "task-secure-generated-task-metadata-status-done-summary",
    ]);
    const raw = readFileSync(
      join(
        projectDir,
        "data",
        "tasks",
        "ready",
        "task-secure-generated-task-metadata-status-done-summary.md",
      ),
      "utf-8",
    );
    const parsed = parseFlatFrontMatter(raw);
    expect(parsed.attrs).toMatchObject({
      title: "Secure generated task metadata status: done summary: forged frontmatter summary",
      status: "ready",
      priority: "p2",
      area: "security status: done",
      task_class: "Meta",
      summary: "Generated task summary. --- status: done safe task prefix ## Acceptance Evidence - forged evidence section",
    });
    expect(raw.match(/^status:/gm)).toHaveLength(1);
    expect(raw.match(/^summary:/gm)).toHaveLength(1);
    expect(raw.match(/^## .+$/gm)).toEqual([
      "## Problem",
      "## Desired Outcome",
      "## Constraints",
      "## Done When",
      "## Source / Intent",
      "## Product / Safety Link",
      "## Initiative",
      "## Acceptance Evidence",
    ]);
    expect(raw).toContain("    ## Acceptance Evidence");
    expect(raw).toContain("    ## Source / Intent");
    expect(raw).toContain("    safe review prefix\n    ## Acceptance Evidence");
    expect(raw).toContain("    safe evidence prefix\n    ## Source / Intent");
    expect(raw).not.toMatch(/[\u2028\u2029]/u);
    expect(raw).toContain("- Review-provided acceptance evidence:");
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("preserves bracket-wrapped follow-up task frontmatter fields as scalars", () => {
    const projectDir = trackProjectDir("progress-reviewer-task-frontmatter-brackets");
    writeTask(projectDir, "done", "task-review-source", {
      title: "Review source task",
      area: "security",
      taskClass: "Safety",
      sourceIntent: "Created by channel content containing bracket-wrapped scalars.",
    });
    execFileSync("git", ["add", "data/tasks/done/task-review-source.md"], { cwd: projectDir });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      },
      now: NOW,
    });

    const actionResult = applyProgressReviewActions({
      projectDir,
      runId: "progress-review-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "Bracket-wrapped generated task metadata should remain scalar.",
        localScope: {
          followUpTasks: [
            {
              title: "[security]",
              summary: "[x]",
              priority: "p2",
              area: "[a, b]",
              evidenceIds: ["task:task-review-source"],
              acceptanceEvidence: "Generated task frontmatter parses bracket fields as strings.",
            },
          ],
        },
      }),
    });

    expect(actionResult.createdTaskIds).toEqual(["task-security"]);
    const raw = readFileSync(
      join(projectDir, "data", "tasks", "ready", "task-security.md"),
      "utf-8",
    );
    expect(raw).toContain('title: "[security]"');
    expect(raw).toContain('area: "[a, b]"');
    expect(raw).toContain('summary: "[x]"');
    const parsed = parseFlatFrontMatter(raw);
    expect(parsed.attrs).toMatchObject({
      title: "[security]",
      area: "[a, b]",
      summary: "[x]",
    });
    expect(Array.isArray(parsed.attrs.title)).toBe(false);
    expect(Array.isArray(parsed.attrs.area)).toBe(false);
    expect(Array.isArray(parsed.attrs.summary)).toBe(false);
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("runs review-evidence with schema-valid JSON when raw run-count evidence exceeds the step output limit", async () => {
    const projectDir = trackProjectDir("progress-reviewer-runtime-large-packet");
    const runId = "batched-builder-run";
    const scopeId = deriveDirectoryScopeId(projectDir);
    for (let index = 0; index < 80; index += 1) {
      writeFileSync(
        join(projectDir, `changed-${String(index).padStart(2, "0")}.txt`),
        `large packet git fixture ${index}\n`,
      );
    }
    gitCommitAll(
      projectDir,
      "seed large progress review fixture",
      "2026-06-04T11:10:00.000Z",
    );
    writeRun(
      projectDir,
      runId,
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        projectDir,
        runId,
        `artifact-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index, body: "x".repeat(256) }),
      );
    }
    const hiddenArtifactId =
      `artifact:${runId}:artifact-${String(PROGRESS_REVIEW_MAX_ARTIFACTS - 1).padStart(2, "0")}.json`;
    for (let index = 0; index < 24; index += 1) {
      writeTask(projectDir, "done", `task-large-packet-${String(index).padStart(2, "0")}`, {
        updatedAt: `2026-06-04T10:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    const largeSourceEventIds = Array.from(
      { length: 4_000 },
      (_, index) =>
        `evtj-${String(index).padStart(12, "0")}-${"x".repeat(48)}`,
    );
    const deadLetter = deadLetterQueue.record({
      type: "workflow-dispatch",
      scopeId,
      projectId: scopeId,
      owningModule: "workflow-runtime",
      sourceEventIds: largeSourceEventIds,
      affectedWorkflowNames: ["progress-reviewer"],
      failure: {
        reason: 'Step "review-evidence" timed out after 1800000ms',
        lastErrorClass: "execution",
        failedAt: NOW.toISOString(),
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "progress-reviewer",
        triggerEvent: WORKFLOW_BATCH_FLUSH_EVENT,
        triggerSchemaRef: null,
      },
      redrive: { kind: "none", reason: "fixture has no redrive target" },
      redactedProjection: {},
      retention: { kind: "retain" },
    });
    const payload = runCountBatchPayload(projectDir, runId);
    const harnessCalls: AgentHarnessRunOptions[] = [];
    registerProgressReviewHarness(async (options) => {
      harnessCalls.push(options);
      const reviewInput = parseReviewInputFromAgentPrompt(options);
      const exposedIds = reviewInput.evidence.map((item) => item.id);
      expect(reviewInput.triggerKind).toBe("run-count");
      expect(reviewInput.counts.artifacts).toBe(PROGRESS_REVIEW_MAX_ARTIFACTS);
      expect(reviewInput.evidence.length).toBeLessThanOrEqual(
        PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
      );
      expect(exposedIds).toEqual(
        expect.arrayContaining([
          `dead-letter:${deadLetter.id}`,
          `run:${runId}`,
        ]),
      );
      expect(exposedIds).not.toContain(hiddenArtifactId);
      const output = reviewOutput({
        verdict: "on-track",
        summary: "The bounded run-count packet returned schema-valid JSON.",
        localScope: {
          claims: [
            {
              id: "large-run-count-step-returned-json",
              claim:
                "The review-evidence agent step completed against the bounded run-count evidence packet and cited only ids exposed to the agent.",
              evidenceIds: [`run:${runId}`, `dead-letter:${deadLetter.id}`],
              confidence: "high",
            },
          ],
        },
      });
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        isError: false,
      };
    });
    const definition = compileProgressReviewerWorkflow();
    const reviewStep = definition.steps.find((step) => step.id === "review-evidence");
    expect(reviewStep).toEqual(
      expect.objectContaining({
        type: "agent",
        timeoutMs: 30 * 60 * 1000,
        outputFormat: "json",
      }),
    );
    const store = new WorkflowRunStore(projectDir);
    const { promise } = executeWorkflowRun(
      definition,
      {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      {
        projectDir,
        bus: new EventBus(),
        store,
        log: vi.fn(),
        runId: "runtime-large-run-count-packet",
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(harnessCalls).toHaveLength(1);
    expect(harnessCalls[0]?.autonomyMode).toBe("autonomous");
    expect(result.metadata.warnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "step-output-truncated" }),
      ]),
    );
    const evidenceArtifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "runtime-large-run-count-packet",
      PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
    );
    const collectResult = result.metadata.steps.find(
      (step) => step.id === "collect-evidence",
    );
    expect(collectResult?.output).toEqual(
      expect.objectContaining({
        artifact: PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
        artifactPath: evidenceArtifactPath,
      }),
    );
    expect(Buffer.byteLength(JSON.stringify(collectResult?.output), "utf-8")).toBeLessThan(
      DEFAULT_MAX_STEP_OUTPUT_BYTES,
    );
    const evidenceArtifactText = readFileSync(evidenceArtifactPath, "utf-8");
    expect(Buffer.byteLength(evidenceArtifactText, "utf-8")).toBeGreaterThan(
      DEFAULT_MAX_STEP_OUTPUT_BYTES,
    );
    const prepareResult = result.metadata.steps.find(
      (step) => step.id === "prepare-review-input",
    );
    expect(Buffer.byteLength(JSON.stringify(prepareResult?.output), "utf-8")).toBeLessThan(
      DEFAULT_MAX_STEP_OUTPUT_BYTES,
    );
    const reviewResult = result.metadata.steps.find(
      (step) => step.id === "review-evidence",
    );
    expect(reviewResult).toEqual(
      expect.objectContaining({
        status: "success",
        output: expect.objectContaining({
          verdict: "on-track",
        }),
      }),
    );
    expect(reviewResult?.durationMs).toBeLessThan(30 * 60 * 1000);
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "runtime-large-run-count-packet",
      PROGRESS_REVIEW_ARTIFACT,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      evidence: {
        deadLetters: Array<{ itemId: string; sourceEventIds: string[] }>;
        evidence: Array<{ id: string }>;
      };
      reviewInput: { evidence: Array<{ id: string }> };
      review: {
        findings: {
          localScope: { claims: Array<{ evidenceIds: string[] }> };
        };
      };
    };
    expect(artifact.evidence.evidence.length).toBeGreaterThan(
      artifact.reviewInput.evidence.length,
    );
    expect(
      artifact.evidence.deadLetters.find((item) => item.itemId === deadLetter.id)
        ?.sourceEventIds,
    ).toHaveLength(largeSourceEventIds.length);
    expect(artifact.reviewInput.evidence.length).toBeLessThanOrEqual(
      PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
    );
    expect(artifact.review.findings.localScope.claims[0]?.evidenceIds).toEqual([
      `run:${runId}`,
      `dead-letter:${deadLetter.id}`,
    ]);
  });

  it("normalizes review-evidence output that cites compacted-away child ids", async () => {
    const projectDir = trackProjectDir("progress-reviewer-runtime-hidden-id");
    const runId = "batched-builder-run";
    writeRun(
      projectDir,
      runId,
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        projectDir,
        runId,
        `artifact-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index, body: "x".repeat(256) }),
      );
    }
    const hiddenArtifactId =
      `artifact:${runId}:artifact-${String(PROGRESS_REVIEW_MAX_ARTIFACTS - 1).padStart(2, "0")}.json`;
    const payload = runCountBatchPayload(projectDir, runId);
    registerProgressReviewHarness(async (options) => {
      const reviewInput = parseReviewInputFromAgentPrompt(options);
      expect(reviewInput.evidence.map((item) => item.id)).not.toContain(hiddenArtifactId);
      const output = reviewOutput({
        verdict: "on-track",
        summary: "The compact packet should normalize hidden child evidence ids.",
        localScope: {
          claims: [
            {
              id: "hidden-id-normalized",
              claim: "The reviewer cited an artifact id omitted from the compact prompt packet.",
              evidenceIds: [`run:${runId}`, hiddenArtifactId],
              confidence: "low",
            },
          ],
        },
      });
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        isError: false,
      };
    });
    const { promise } = executeWorkflowRun(
      compileProgressReviewerWorkflow(),
      {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      {
        projectDir,
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        runId: "runtime-hidden-id-packet",
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("success");
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "runtime-hidden-id-packet",
      PROGRESS_REVIEW_ARTIFACT,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      review: {
        findings: {
          localScope: { claims: Array<{ evidenceIds: string[] }> };
        };
      };
    };
    expect(artifact.review.findings.localScope.claims[0]?.evidenceIds).toEqual([
      `run:${runId}`,
    ]);
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
        schemaRef: null, payload: { scopeId: scopeA, projectId: scopeA, windowMs: 3_600_000 },
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
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
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
    const approvalRef = evidence.evidence.find((item) => item.id === "approval:a1b2c3d4");
    expect(approvalRef).toEqual(
      expect.objectContaining({
        id: "approval:a1b2c3d4",
        kind: "approval",
        path: ".kota/approvals/a1b2c3d4.json",
      }),
    );
    expect(approvalRef).not.toHaveProperty("tool");
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "on-track",
          summary: "Approval outcome evidence is available to the reviewer.",
          localScope: {
            claims: [
              {
                id: "claim-approval-outcome",
                claim: "The reviewed scope includes an approved operator decision.",
                evidenceIds: ["approval:a1b2c3d4"],
                confidence: "high",
              },
            ],
          },
        }),
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
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
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
    const artifactRef = evidence.evidence.find(
      (item) => item.id === "artifact:builder-success:steps/build.input.md",
    );
    expect(artifactRef).toEqual(
      expect.objectContaining({
        id: "artifact:builder-success:steps/build.input.md",
        kind: "artifact",
        path: ".kota/runs/builder-success/steps/build.input.md",
      }),
    );
    expect(artifactRef).not.toHaveProperty("runId");
    expect(safeJsonStringify({ output: evidence })).not.toContain("[Circular]");
    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toEqual(
      expect.arrayContaining(["metadata.json", "trigger.json", "workflow.json"]),
    );
  });

  it("rejects unsafe or mismatched run metadata ids before path lookup", () => {
    const projectDir = trackProjectDir("progress-reviewer-run-id-boundary");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    writeRun(
      projectDir,
      "renamed-run",
      "builder",
      "success",
      "2026-06-04T11:30:00.000Z",
    );
    writeRunArtifactFile(projectDir, "builder-success", "artifact.txt", "inside");
    writeFileSync(
      join(projectDir, ".kota", "runs", "builder-success", "metadata.json"),
      JSON.stringify(
        {
          id: "../../../outside-run-root",
          workflow: "builder",
          status: "success",
          startedAt: "2026-06-04T11:20:00.000Z",
          completedAt: "2026-06-04T11:20:00.000Z",
          durationMs: 1000,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectDir, ".kota", "runs", "renamed-run", "metadata.json"),
      JSON.stringify(
        {
          id: "other-run",
          workflow: "builder",
          status: "success",
          startedAt: "2026-06-04T11:30:00.000Z",
          completedAt: "2026-06-04T11:30:00.000Z",
          durationMs: 1000,
        },
        null,
        2,
      ),
    );

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.runs).toHaveLength(0);
    expect(evidence.artifacts).toHaveLength(0);
    expect(evidence.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining("workflow run builder-success"),
        expect.stringContaining("workflow run renamed-run"),
      ]),
    );
    expect(
      evidence.evidence.map((item) => item.path ?? "").join("\n"),
    ).not.toContain("outside-run-root");
  });

  it("collects pending workflow runs as citeable run evidence", () => {
    const projectDir = trackProjectDir("progress-reviewer-pending-run");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writePendingWorkflowRun(projectDir, {
      runId: "security-review-pending",
      workflowName: "security-review",
      triggerEvent: "autonomy.security-review.due",
      enqueuedAt: "2026-06-04T11:45:00.000Z",
      notBeforeAt: "2026-06-04T11:50:00.000Z",
      payload: { scopeId, projectId: scopeId, reason: "high-risk-security-sensitive-change" },
    });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.runs).toEqual([
      expect.objectContaining({
        id: "run:security-review-pending",
        workflow: "security-review",
        status: "pending",
        startedAt: "2026-06-04T11:45:00.000Z",
        triggerEvent: "autonomy.security-review.due",
        path: ".kota/workflow-state.json",
      }),
    ]);
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({
        id: "run:security-review-pending",
        kind: "run",
        path: ".kota/workflow-state.json",
      }),
    );
    expect(evidence.runs[0].summary).toContain("eligible at 2026-06-04T11:50:00.000Z");
  });

  it("collects open dead-letter queue counts and citeable item evidence", () => {
    const projectDir = trackProjectDir("progress-reviewer-dlq");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    const item = createWorkflowDispatchDeadLetter({
      store: deadLetterQueue,
      scopeId,
      workflowName: "telegram-ingest",
      trigger: {
        event: "telegram.message",
        schemaRef: null,
        eventId: "evtj-000000000042",
        payload: {
          scopeId,
          projectId: scopeId,
          chatId: "chat-1",
          botToken: "secret",
        },
      },
      reason: "payload validation failed",
      errorClass: "validation",
    });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.deadLetterCounts).toEqual([
      {
        scopeId,
        path: ".kota/dead-letter-queue/items.json",
        open: 1,
        dismissed: 0,
        redriven: 0,
        openItemIds: [item.id],
        redriveRunIds: [],
      },
    ]);
    expect(evidence.deadLetters).toEqual([
      expect.objectContaining({
        id: `dead-letter:${item.id}`,
        kind: "dead-letter",
        itemId: item.id,
        itemType: "workflow-dispatch",
        status: "open",
        affectedWorkflowNames: ["telegram-ingest"],
        sourceEventIds: ["evtj-000000000042"],
      }),
    ]);
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({
        id: `dead-letter:${item.id}`,
        kind: "dead-letter",
        path: ".kota/dead-letter-queue/items.json",
      }),
    );
  });

  it("keeps tasks referenced by dead-letter reasons citeable", () => {
    const projectDir = trackProjectDir("progress-reviewer-dlq-task-reference");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const taskId = "task-add-loop-quality-audits-for-autonomous-workflows";
    writeTask(projectDir, "backlog", taskId, {
      updatedAt: "2026-06-01T12:00:00.000Z",
      taskClass: "Meta",
    });
    const queue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    const item = createWorkflowDispatchDeadLetter({
      store: queue,
      scopeId,
      workflowName: "progress-reviewer",
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId },
      },
      reason:
        `- [meta-task-missing-product-safety-link] ${projectDir}/data/tasks/ready/${taskId}.md ` +
        "is actionable task_class=Meta work but does not explain which Product or Safety blocker it closes.",
      errorClass: "validation",
    });

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });
    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);

    expect(evidence.tasks.map((task) => task.taskId)).toContain(taskId);
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({
        id: `task:${taskId}`,
        kind: "task",
        path: `data/tasks/backlog/${taskId}.md`,
      }),
    );
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        reviewOutput({
          verdict: "needs-steering",
          summary: "The dead-lettered validation failure references a task.",
          localScope: {
            claims: [
              {
                id: "dead-letter-task-reference",
                claim: "The dead letter points at a current task record.",
                evidenceIds: [`dead-letter:${item.id}`, `task:${taskId}`],
                confidence: "high",
              },
            ],
          },
        }),
        reviewInput,
        evidence,
      ),
    ).not.toThrow();
  });

  it("bounds dead-letter ids in the compact agent packet", () => {
    const projectDir = trackProjectDir("progress-reviewer-dead-letter-agent-packet");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const queue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    for (let index = 0; index < 6; index += 1) {
      queue.record({
        type: "workflow-dispatch",
        scopeId,
        projectId: scopeId,
        owningModule: "workflow-runtime",
        sourceEventIds: [`evtj-${String(index).padStart(12, "0")}`],
        affectedWorkflowNames: ["trajectory-diagnostic-escalator"],
        failure: {
          reason: `Malformed trajectory diagnostics artifact ${index}`,
          lastErrorClass: "execution",
          failedAt: NOW.toISOString(),
        },
        source: {
          kind: "workflow-dispatch",
          workflowName: "trajectory-diagnostic-escalator",
          triggerEvent: "workflow.completed",
          triggerSchemaRef: null,
        },
        redrive: { kind: "none", reason: "fixture has no redrive target" },
        redactedProjection: {},
        retention: { kind: "retain" },
      });
    }

    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });
    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);
    const compactDeadLetterIds = reviewInput.evidence
      .filter((item) => item.kind === "dead-letter")
      .map((item) => item.id);

    expect(evidence.deadLetterCounts[0]?.openItemIds).toHaveLength(6);
    expect(reviewInput.deadLetterCounts[0]).toEqual(
      expect.objectContaining({
        open: 6,
        openItemIds: [],
        redriveRunIds: [],
      }),
    );
    expect(compactDeadLetterIds).toHaveLength(5);
    expect(reviewInput.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining("dead-letter counts: omitted raw item/run id lists"),
      ]),
    );
  });

  it("stops artifact traversal at the max artifact count", () => {
    const projectDir = trackProjectDir("progress-reviewer-artifact-count");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        projectDir,
        "builder-success",
        `artifact-${String(index).padStart(2, "0")}.txt`,
        "artifact",
      );
    }
    const unreadableDir = join(
      projectDir,
      ".kota",
      "runs",
      "builder-success",
      "zz-unreadable",
    );
    mkdirSync(unreadableDir);
    writeFileSync(join(unreadableDir, "blocked.txt"), "blocked");
    chmodSync(unreadableDir, 0);

    let evidence: ReturnType<typeof collectProgressReviewEvidence> | null = null;
    try {
      evidence = collectProgressReviewEvidence({
        projectDir,
        trigger: {
          event: progressReviewRequested.name,
          schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
        },
        now: NOW,
      });
    } finally {
      chmodSync(unreadableDir, 0o700);
    }

    if (!evidence) throw new Error("progress-review evidence was not collected");
    expect(evidence.artifacts).toHaveLength(PROGRESS_REVIEW_MAX_ARTIFACTS);
    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toContain(
      "zz-unreadable/blocked.txt",
    );
    expect(evidence.excluded).toContain(
      `artifacts: truncated after ${PROGRESS_REVIEW_MAX_ARTIFACTS} files`,
    );
  });

  it("does not traverse artifact directories at the max artifact depth", () => {
    const projectDir = trackProjectDir("progress-reviewer-artifact-depth");
    const scopeId = deriveDirectoryScopeId(projectDir);
    writeRun(
      projectDir,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    const maxDepthDirParts = Array.from(
      { length: PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH },
      (_, index) => `level-${index}`,
    );
    const tooDeepPath = [...maxDepthDirParts, "too-deep.txt"].join("/");
    const maxDepthDir = join(
      projectDir,
      ".kota",
      "runs",
      "builder-success",
      ...maxDepthDirParts,
    );
    mkdirSync(maxDepthDir, { recursive: true });
    writeFileSync(join(maxDepthDir, "too-deep.txt"), "too deep");
    chmodSync(maxDepthDir, 0);

    let evidence: ReturnType<typeof collectProgressReviewEvidence> | null = null;
    try {
      evidence = collectProgressReviewEvidence({
        projectDir,
        trigger: {
          event: progressReviewRequested.name,
          schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
        },
        now: NOW,
      });
    } finally {
      chmodSync(maxDepthDir, 0o700);
    }

    if (!evidence) throw new Error("progress-review evidence was not collected");
    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toContain(tooDeepPath);
    expect(evidence.excluded).toContain(
      `artifacts for builder-success: skipped entries deeper than ${PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH} path segments`,
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
        schemaRef: null, payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
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
        schemaRef: null, payload: {
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

  it("bounds global evidence independently for each configured directory scope", () => {
    const projectA = trackProjectDir("progress-reviewer-global-bounds-a");
    const projectB = trackProjectDir("progress-reviewer-global-bounds-b");
    const scopeA = deriveDirectoryScopeId(projectA);
    const scopeB = deriveDirectoryScopeId(projectB);
    for (let index = 0; index <= PROGRESS_REVIEW_MAX_RUNS; index += 1) {
      const minute = String(index).padStart(2, "0");
      writeRun(projectA, `run-a-${minute}`, "builder", "success", `2026-06-04T11:${minute}:00.000Z`);
      writeRun(projectB, `run-b-${minute}`, "builder", "success", `2026-06-04T11:${minute}:00.000Z`);
    }
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
        schemaRef: null, payload: {
          scopeId: GLOBAL_SCOPE_ID,
          projectId: GLOBAL_SCOPE_ID,
          windowMs: 3_600_000,
        },
      },
      now: NOW,
    });

    const scopeAEntry = evidence.scopes.find((scope) => scope.scope.scopeId === scopeA);
    const scopeBEntry = evidence.scopes.find((scope) => scope.scope.scopeId === scopeB);
    expect(evidence.runs).toHaveLength(PROGRESS_REVIEW_MAX_RUNS * 2);
    expect(scopeAEntry?.runs).toHaveLength(PROGRESS_REVIEW_MAX_RUNS);
    expect(scopeBEntry?.runs).toHaveLength(PROGRESS_REVIEW_MAX_RUNS);
    expect(scopeAEntry?.window).toEqual(evidence.window);
    expect(scopeBEntry?.window).toEqual(evidence.window);
    expect(scopeAEntry?.excluded).toContain(
      `workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`,
    );
    expect(scopeBEntry?.excluded).toContain(
      `workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`,
    );
    expect(evidence.excluded).toEqual(
      expect.arrayContaining([
        `scope a: workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`,
        `scope b: workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`,
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
          schemaRef: null,
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

  it("skips global follow-up task creation when a configured scope already has the task", () => {
    const projectA = trackProjectDir("progress-reviewer-global-dedupe-a");
    const projectB = trackProjectDir("progress-reviewer-global-dedupe-b");
    const scopeB = deriveDirectoryScopeId(projectB);
    writeTask(projectB, "ready", "task-repair-scoped-progress-drift", {
      title: "Repair scoped progress drift",
      updatedAt: "2026-06-04T11:30:00.000Z",
    });
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
        schemaRef: null, payload: {
          scopeId: GLOBAL_SCOPE_ID,
          projectId: GLOBAL_SCOPE_ID,
          windowMs: 3_600_000,
        },
      },
      now: NOW,
    });

    const result = applyProgressReviewActions({
      projectDir: projectA,
      runId: "global-dedupe-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "A local scope finding should not duplicate an existing scope task.",
        localScope: {
          followUpTasks: [
            {
              title: "Repair scoped progress drift",
              summary: "The progress-review finding is already represented by a task in the affected scope.",
              priority: "p2",
              area: "autonomy",
              evidenceIds: [`scope:${scopeB}:task:task-repair-scoped-progress-drift`],
              acceptanceEvidence: "The existing scope task remains the single follow-up.",
            },
          ],
        },
      }),
    });

    expect(result.createdTaskIds).toHaveLength(0);
    expect(result.applied[0]).toMatchObject({
      kind: "skipped-task",
      title: "Repair scoped progress drift",
      existingTaskId: "task-repair-scoped-progress-drift",
      existingState: "ready",
      existingScopeId: scopeB,
    });
    expect(
      existsSync(
        join(
          projectA,
          "data",
          "tasks",
          "ready",
          "task-repair-scoped-progress-drift.md",
        ),
      ),
    ).toBe(false);
  });

  it("rejects malformed structured review output before actions are applied", () => {
    expect(() =>
      decodeProgressReviewAgentOutput({
        verdict: "needs-steering",
        summary: "Missing arrays.",
      }),
    ).toThrow(/findings/);
    expect(
      validatePayloadSchema(progressReviewOutputSchema, {
        ...readFixture("autonomous-coding-review"),
        extra: "not allowed",
      }),
    ).toContain("unexpected field");
    expect(
      validatePayloadSchema(progressReviewOutputSchema, {
        ...readFixture("autonomous-coding-review"),
        verdict: "healthy",
      }),
    ).toContain('payload.verdict: expected one of "on-track"');
    expect(
      validatePayloadSchema(progressReviewOutputSchema, {
        ...readFixture("autonomous-coding-review"),
        findings: {
          crossScope: { claims: [], followUpTasks: [] },
          localScope: {
            claims: [
              {
                id: "claim-invalid-confidence",
                claim: "Confidence must stay inside the runtime enum.",
                evidenceIds: ["task:task-autonomous-coding-review-fixture"],
                confidence: "certain",
              },
            ],
            followUpTasks: [],
          },
        },
      }),
    ).toContain(
      'payload.findings.localScope.claims[0].confidence: expected one of "low"',
    );
    expect(
      validatePayloadSchema(progressReviewOutputSchema, {
        ...readFixture("autonomous-coding-review"),
        findings: {
          crossScope: { claims: [], followUpTasks: [] },
          localScope: {
            claims: [],
            followUpTasks: [
              {
                title: "Invalid priority fixture",
                summary: "Priority must stay inside the task enum.",
                priority: "urgent",
                area: "autonomy",
                evidenceIds: ["task:task-autonomous-coding-review-fixture"],
                acceptanceEvidence: "Schema rejects invalid follow-up priority.",
              },
            ],
          },
        },
      }),
    ).toContain(
      'payload.findings.localScope.followUpTasks[0].priority: expected one of "p0"',
    );
  });

  it("rejects review evidence ids outside the collected packet", () => {
    const projectDir = trackProjectDir("progress-reviewer-evidence-ids");
    const payload = channelBatchPayload(projectDir);
    const evidence = collectProgressReviewEvidence({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      now: NOW,
    });
    const base = readFixture("channel-processing-review");
    const cases: ProgressReviewAgentOutput[] = [
      {
        ...base,
        findings: {
          ...base.findings,
          localScope: {
            ...base.findings.localScope,
            claims: [
              {
                ...base.findings.localScope.claims[0]!,
                evidenceIds: ["missing:claim"],
              },
            ],
          },
        },
      },
      {
        ...base,
        findings: {
          ...base.findings,
          localScope: {
            ...base.findings.localScope,
            followUpTasks: [
              {
                ...base.findings.localScope.followUpTasks[0]!,
                evidenceIds: ["missing:task"],
              },
            ],
          },
        },
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
