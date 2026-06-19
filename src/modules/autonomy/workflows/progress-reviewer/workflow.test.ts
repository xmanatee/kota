import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
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
import { AUTONOMY_AGENT_HARNESS } from "#modules/autonomy/shared.js";
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
  PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH,
  PROGRESS_REVIEW_MAX_ARTIFACTS,
  PROGRESS_REVIEW_MAX_RUNS,
  PROGRESS_REVIEW_SCHEDULE_EVENT,
  type ProgressReviewActionResult,
  type ProgressReviewAgentEvidencePacket,
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
  options: {
    title?: string;
    updatedAt?: string;
    area?: string;
    taskClass?: "Product" | "Safety" | "Platform" | "Meta";
    acceptanceEvidence?: string;
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
    "Progress reviewer test fixture.",
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
    name: AUTONOMY_AGENT_HARNESS,
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
  ])[0]!;
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

  it("keeps the prompt aligned with fenced JSON output extraction", () => {
    const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf-8");
    const definition = compileProgressReviewerWorkflow();
    const reviewStep = definition.steps.find((step) => step.id === "review-evidence");

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

    const hidden = evidence.evidence.find((item) => !exposedIds.has(item.id));
    if (!hidden) throw new Error("expected at least one hidden evidence id");
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
          summary: "Hidden ids should not be accepted.",
          localScope: {
            claims: [
              {
                id: "claim-hidden-id",
                claim: "The review cited a hidden id.",
                evidenceIds: [hidden.id],
                confidence: "low",
              },
            ],
          },
        }),
        reviewInput,
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

  it("runs review-evidence with schema-valid JSON for a large run-count packet before the step timeout", async () => {
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
                "The review-evidence agent step completed against the bounded run-count evidence packet and cited a collected artifact id that was omitted from the compact prompt packet.",
              evidenceIds: [
                `run:${runId}`,
                `dead-letter:${deadLetter.id}`,
                hiddenArtifactId,
              ],
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
      evidence: { evidence: Array<{ id: string }> };
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
    expect(artifact.reviewInput.evidence.length).toBeLessThanOrEqual(
      PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
    );
    expect(artifact.review.findings.localScope.claims[0]?.evidenceIds).toEqual([
      `run:${runId}`,
      `dead-letter:${deadLetter.id}`,
      hiddenArtifactId,
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
