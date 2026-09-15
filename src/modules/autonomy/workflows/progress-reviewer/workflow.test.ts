import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarnessRunOptions,
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
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import {
  type RunArtifactManifest,
  retainRunArtifacts,
} from "#core/workflow/run-artifact-handoff.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "#core/workflow/trigger-types.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import {
  progressReviewRequested,
} from "./events.js";
import { progressReviewNeedsAttention } from "./progress-review/actions.js";
import {
  applyProgressReviewActions,
  classifyProgressReviewTrigger,
  collectProgressReviewEvidence,
  collectProgressReviewGitEvidence,
  compactProgressReviewEvidenceForAgent,
  decodeProgressReviewAgentOutput,
  decodeProgressReviewAgentOutputForEvidence,
  PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
  PROGRESS_REVIEW_ARTIFACT,
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
  PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH,
  PROGRESS_REVIEW_MAX_ARTIFACTS,
  PROGRESS_REVIEW_MAX_RUNS,
  type ProgressReviewAgentOutput,
  type ProgressReviewArtifact,
  readTaskStatus,
} from "./progress-review.js";
import progressReviewerWorkflow, { progressReviewOutputSchema } from "./workflow.js";
import {
  channelBatchPayload,
  commitProgressReviewFixture,
  compileProgressReviewerWorkflow,
  makeProgressReviewRunContext,
  makeProgressReviewScopeRoot,
  NOW,
  parseReviewInputFromAgentPrompt,
  readProgressReviewFixture,
  registerProgressReviewHarness,
  reviewOutput,
} from "./workflow.test-helpers.js";

const readFixture = readProgressReviewFixture;

function collectEvidence(
  workspaceRoot: string,
  trigger: Parameters<typeof collectProgressReviewEvidence>[0]["trigger"],
) {
  return collectProgressReviewEvidence({
    workspaceRoot,
    scopeRoot: workspaceRoot,
    stateDir: join(workspaceRoot, ".kota"),
    runtimeStateDir: join(workspaceRoot, ".kota"),
    trigger,
    now: NOW,
  });
}

function citingReview(evidenceIds: string[], claim: string): ProgressReviewAgentOutput {
  return reviewOutput({
    verdict: "on-track",
    summary: claim,
    localScope: { claims: [{ id: "claim", claim, evidenceIds, confidence: "high" }] },
  });
}

function writeTask(
  workspaceRoot: string,
  state: string,
  id: string,
  options: {
    title?: string;
    howWeWillKnow?: string;
    sourceIntent?: string;
  } = {},
): void {
  const title = options.title ?? id;
  const terminal = state === "done" || state === "dropped";
  const content = [
    "---",
    `status: ${state}`,
    ...(terminal ? [] : ["priority: p2"]),
    "---",
    "",
    `# ${title}`,
    "",
    renderRepoTaskIntent({
      problem: "Review fixture problem.",
      desiredOutcome: "Review fixture outcome.",
      constraints: "- Keep cited context available to the reviewer.",
      howWeWillKnow: options.howWeWillKnow ?? "- The fixture outcome is observable.",
      context: options.sourceIntent ?? "Progress reviewer test fixture.",
    }),
  ].join("\n");
  writeFileSync(
    join(
      workspaceRoot,
      "data",
      "tasks",
      ...(terminal ? ["archive"] : []),
      `${id}.md`,
    ),
    content,
  );
}

function writeInboxEntry(workspaceRoot: string, id: string, title: string): void {
  mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "data", "inbox", `${id}.md`),
    `# ${title}\n`,
  );
}

function writeRun(
  workspaceRoot: string,
  id: string,
  workflow: string,
  status: string,
  startedAt: string,
): void {
  const runDir = join(workspaceRoot, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify(
		{
			id,
			workflow,
			definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
			runDir: `.kota/runs/${id}`,
			trigger: {
				event: "autonomy.queue.available",
				schemaRef: null,
				payload: {},
			},
			status,
			startedAt,
			completedAt: startedAt,
			durationMs: 1000,
			steps: [],
		},
      null,
      2,
    ),
  );
  writeFileSync(
    join(runDir, "trigger.json"),
    JSON.stringify({ event: "autonomy.queue.available", schemaRef: null, payload: {} }, null, 2),
  );
}

function writePendingWorkflowRun(
  workspaceRoot: string,
  pendingRun: {
    runId: string;
    workflowName: string;
    triggerEvent: string;
    enqueuedAt: string;
    notBeforeAt?: string;
    payload?: Record<string, unknown>;
  },
): void {
  const scopeId = deriveDirectoryScopeId(workspaceRoot);
  const state = new RunStateDatabase(join(workspaceRoot, ".kota"));
  state.registerScope({
    id: scopeId,
    rootPath: workspaceRoot,
    createdAt: pendingRun.enqueuedAt,
  });
  state.admitRun({
    id: pendingRun.runId,
    scopeId,
    workflow: pendingRun.workflowName,
    repository: "read",
    trigger: {
      event: pendingRun.triggerEvent,
      schemaRef: null,
      payload: pendingRun.payload ?? {},
    },
    resources: [],
    admittedAt: pendingRun.enqueuedAt,
    ...(pendingRun.notBeforeAt === undefined
      ? {}
      : { notBeforeAt: pendingRun.notBeforeAt }),
  });
  state.close();
}

function writeRunArtifactFile(
  workspaceRoot: string,
  runId: string,
  relativePath: string,
  contents: string,
): void {
  const path = join(workspaceRoot, ".kota", "runs", runId, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writeApproval(
  workspaceRoot: string,
  id: string,
  status: "approved" | "rejected" | "expired" | "pending",
  createdAt: string,
  resolvedAt?: string,
): void {
  mkdirSync(join(workspaceRoot, ".kota", "approvals"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, ".kota", "approvals", `${id}.json`),
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

function runCountBatchPayload(workspaceRoot: string, runId: string): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(workspaceRoot);
  return {
    scopeId,
    sourceEventName: "workflow.completed",
    groupingKey: `scopeId=${scopeId}`,
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

describe("progress-reviewer workflow", () => {
  const scopeRoots: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModuleEventRegistry();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function trackScopeRoot(label?: string): string {
    const dir = makeProgressReviewScopeRoot(label);
    scopeRoots.push(dir);
    return dir;
  }

  it("writes an explicit no-op artifact for an autonomous coding scope review", async () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-coding");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeTask(workspaceRoot, "done", "task-ship-coding-slice", {
      title: "Ship coding slice",
    });
    writeRun(
      workspaceRoot,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    commitProgressReviewFixture(
      workspaceRoot,
      "prepare coding review fixture",
      "2026-06-04T11:31:00.000Z",
    );

    const harness = new WorkflowScenarioDriver(progressReviewerWorkflow, {
      workspaceRoot,
      ports: { runCommand: runGitEvidenceCommand },
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, windowMs: 3_600_000, reason: "operator requested a milestone review" },
      },
      stepOutputs: {
        "review-evidence": readFixture("autonomous-coding-review"),
      },
    });

    const result = await harness.run();

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    expect(result.steps["review-evidence"].status, JSON.stringify(result.steps["review-evidence"])).toBe("success");
    const artifactPath = join(result.runDirPath, PROGRESS_REVIEW_ARTIFACT);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as ProgressReviewArtifact;
    expect(artifact.evidence.scope.scopeId).toBe(scopeId);
    expect(artifact.evidence.triggerKind).toBe("manual");
    expect(artifact.evidence.triggerEvent).toBe(progressReviewRequested.name);
    expect(artifact.evidence.runs.map((run) => run.workflow)).toContain("builder");
    expect(artifact.evidence.tasks.map((task) => task.taskId)).toContain("task-ship-coding-slice");
    expect(artifact.reviewInput.evidence.map((item) => item.id)).toContain(
      "run:builder-success",
    );
    expect(artifact.review.verdict).toBe("on-track");
    expect(artifact.actions.createdTaskIds).toHaveLength(0);
  });

  it("writes an explicit global review with attributable evidence from both scopes", async () => {
    const scopes = ["a", "b"].map((label) => {
      const root = trackScopeRoot(`global-${label}`);
      writeTask(root, "done", `task-scope-${label}`);
      writeRun(root, `run-scope-${label}`, "builder", "success", "2026-06-04T11:20:00.000Z");
      commitProgressReviewFixture(root, "prepare review", "2026-06-04T11:31:00.000Z");
      return { root, id: deriveDirectoryScopeId(root), label };
    });
    const workspaceRoot = scopes[0]!.root;
    new ScopeRegistry({
      stateDir: join(workspaceRoot, ".kota"),
      scopes: scopes.map(({ root, label }) => ({ scopeRoot: root, displayName: `scope ${label}` })),
    });
    const evidenceIds = scopes.map(({ id, label }) => `scope:${id}:run:run-scope-${label}`);
    const result = await new WorkflowScenarioDriver(progressReviewerWorkflow, {
      workspaceRoot,
      ports: {
        state: { stateDir: join(workspaceRoot, ".kota"), scopeId: scopes[0]!.id },
        runCommand: runGitEvidenceCommand,
      },
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId: GLOBAL_SCOPE_ID, reason: "operator global review" },
      },
      stepOutputs: {
        "review-evidence": reviewOutput({
          verdict: "on-track",
          summary: "Both configured scopes have attributable evidence.",
          crossScope: { claims: [{ id: "both-scopes", claim: "Both scopes progressed.", evidenceIds, confidence: "high" }] },
        }),
      },
    }).run();
    expect(result.status, result.error).toBe("success");
    const artifact = JSON.parse(readFileSync(join(result.runDirPath, PROGRESS_REVIEW_ARTIFACT), "utf8")) as ProgressReviewArtifact;
    expect(artifact.evidence).toMatchObject({
      triggerKind: "manual",
      triggerEvent: progressReviewRequested.name,
      scope: { kind: "global", scopeId: GLOBAL_SCOPE_ID },
    });
    expect(artifact.evidence.runs.map((run) => run.id)).toEqual(expect.arrayContaining(evidenceIds));
    for (const { root, id, label } of scopes) {
      expect(artifact.evidence.tasks.map((task) => task.taskId)).toContain(`task-scope-${label}`);
      expect(artifact.evidence.scopes.find((entry) => entry.scope.scopeId === id)).toMatchObject({
        scope: { kind: "directory", scopeId: id, displayName: `scope ${label}`, directoryRoot: root },
        window: artifact.evidence.window,
        excluded: [],
        runs: expect.arrayContaining([expect.objectContaining({ id: `scope:${id}:run:run-scope-${label}` })]),
        tasks: expect.arrayContaining([expect.objectContaining({ taskId: `task-scope-${label}` })]),
      });
      expect(artifact.reviewInput.scopes.find((entry) => entry.scope.scopeId === id)).toMatchObject({
        window: artifact.evidence.window, excluded: [],
      });
      expect(artifact.reviewInput.evidence.map((item) => item.summary)).toEqual(expect.arrayContaining([expect.stringContaining(`[scope ${label}]`)]));
    }
    expect(artifact.review.findings.crossScope.claims[0]?.evidenceIds).toEqual(evidenceIds);
    expect(artifact.review.findings.localScope.claims).toHaveLength(0);
  });

  it("creates one follow-up and leaves task bytes and attention unchanged on replay", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-channel");
    const evidence = collectEvidence(workspaceRoot, {
      event: WORKFLOW_BATCH_FLUSH_EVENT, schemaRef: null, payload: channelBatchPayload(workspaceRoot),
    });
    const review = readFixture("channel-processing-review");
    review.ownerQuestions = [];
    const first = applyProgressReviewActions({ workspaceRoot, evidence, review, runId: "first-review" });
    expect(first.createdTaskIds).toHaveLength(1);
    const taskId = first.createdTaskIds[0]!;
    expect(readTaskStatus(workspaceRoot, taskId)).toBe("open");
    expect(first.ownerQuestionIds).toEqual([]);
    expect(progressReviewNeedsAttention(first)).toBe(true);
    const path = join(workspaceRoot, "data", "tasks", `${taskId}.md`);
    const bytes = readFileSync(path, "utf8");
    expect(bytes).toContain("Add channel progress review routing fixture");
    utimesSync(path, NOW, NOW);
    const mtime = statSync(path).mtimeMs;
    const repeated = applyProgressReviewActions({ workspaceRoot, evidence, review, runId: "repeated-review" });
    expect(repeated).toMatchObject({ createdTaskIds: [], ownerQuestionIds: [], touchedTaskQueue: false });
    expect(repeated.applied).toEqual([expect.objectContaining({ kind: "skipped-task", existingTaskId: taskId })]);
    expect(progressReviewNeedsAttention(repeated)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(bytes);
    expect(statSync(path).mtimeMs).toBe(mtime);
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
    expect(() => assertTaskQueueValid(workspaceRoot)).not.toThrow();
  });

  it("stages an owner question when a topic changes from task to owner decision", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-proposal-kind-change");
    const payload = channelBatchPayload(workspaceRoot);
    const evidence = collectEvidence(workspaceRoot, {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      });
    const topicKey = "channel-routing-decision";
    const task = readFixture("channel-processing-review")
      .findings.localScope.followUpTasks[0]!;

    const created = applyProgressReviewActions({
      workspaceRoot,
      runId: "task-disposition-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "The routing gap initially looked locally actionable.",
        localScope: {
          followUpTasks: [{ ...task, topicKey }],
        },
      }),
    });
    const taskId = created.createdTaskIds[0]!;

    const changed = applyProgressReviewActions({
      workspaceRoot,
      runId: "question-disposition-run",
      evidence,
      review: reviewOutput({
        verdict: "blocked",
        summary: "The same routing topic now needs an owner decision.",
        ownerQuestions: [{
          topicKey,
          question: "Which channel-routing policy should the task implement?",
          reason: "The evidence supports two incompatible operator journeys.",
          evidenceIds: ["event:1"],
          proposedAnswers: ["Rendered routing", "Transcript routing"],
        }],
      }),
    });

    expect(readTaskStatus(workspaceRoot, taskId)).toBe("dropped");
    expect(changed.ownerQuestionIds).toHaveLength(0);
    expect(changed.touchedTaskQueue).toBe(true);
    expect(changed.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dropped-task", taskId }),
        expect.objectContaining({ kind: "owner-question-pending" }),
      ]),
    );
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
  });

  it("does not treat build commits as semantic progress boundaries", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-batch-kind");
    const channelBatch = channelBatchPayload(workspaceRoot);
    const runBatch = {
      ...channelBatch,
      sourceEventName: "workflow.completed",
      inputEvents: [
        {
          event: "workflow.completed",
          schemaRef: null,
          receivedAt: NOW.toISOString(),
          payload: {
            scopeId: channelBatch.scopeId,
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
            scopeId: channelBatch.scopeId,
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
    ).toBe("event-batch");
    expect(
      classifyProgressReviewTrigger({
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null, payload: channelBatch,
      }),
    ).toBe("message-batch");
  });

  it("keeps workflow batch run ids citeable when recent runs are truncated", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-batch-run-evidence");
    writeRun(
      workspaceRoot,
      "batched-builder-run",
      "builder",
      "success",
      "2026-06-04T10:00:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_RUNS; index += 1) {
      writeRun(
        workspaceRoot,
        `newer-run-${String(index).padStart(2, "0")}`,
        "workflow-failure-escalator",
        "success",
        `2026-06-04T11:${String(index).padStart(2, "0")}:00.000Z`,
      );
    }
    const payload: WorkflowBatchFlushPayload = runCountBatchPayload(workspaceRoot, "batched-builder-run");

    const evidence = collectEvidence(workspaceRoot, {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
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
  });

  it("quarantines malformed terminal batch run metadata without blocking review", () => {
    const workspaceRoot = trackScopeRoot(
      "progress-reviewer-batch-run-quarantine",
    );
    const runId = "malformed-terminal-run";
    const runDir = join(workspaceRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, status: "success" }),
    );

    const evidence = collectEvidence(workspaceRoot, {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload: runCountBatchPayload(workspaceRoot, runId),
      });

    expect(evidence.runs.map((run) => run.id)).not.toContain(`run:${runId}`);
    expect(evidence.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining("workflow run metadata quarantined"),
      ]),
    );
  });

  it("collects nested artifact citations and prioritizes outcome evidence over step noise", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-artifacts");
    const noiseRunId = "aaaa-blocked-promoter-run";
    const builderRunId = "zzzz-builder-run";
    writeRun(
      workspaceRoot,
      noiseRunId,
      "blocked-promoter",
      "success",
      "2026-06-04T10:59:00.000Z",
    );
    writeRun(
      workspaceRoot,
      builderRunId,
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    const noiseArtifactCount = 24;
    for (let index = 0; index < noiseArtifactCount; index += 1) {
      writeRunArtifactFile(
        workspaceRoot,
        noiseRunId,
        `steps/noise-${String(index).padStart(2, "0")}.json`,
        "{}",
      );
    }
    const outcomeFiles = [
      "acceptance-evidence.txt",
      "critic-review.json",
      "evaluator-calibration.json",
    ];
    const stepFiles = [
      "steps/build.json",
      "steps/build.input.md",
      "steps/build.events.jsonl",
      "steps/build.tool-telemetry.json",
    ];
    // Collection inventories paths; file contents are not parsed by this owner.
    for (const file of [...outcomeFiles, ...stepFiles]) {
      writeRunArtifactFile(workspaceRoot, builderRunId, file, "artifact");
    }
    writeRunArtifactFile(workspaceRoot, builderRunId, "workflow.json", "{}");

    const evidence = collectEvidence(workspaceRoot, {
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      schemaRef: null,
      payload: runCountBatchPayload(workspaceRoot, builderRunId),
    });
    for (const file of stepFiles) {
      expect(evidence.artifacts).toContainEqual(
        expect.objectContaining({
          id: `artifact:${builderRunId}:${file}`,
          file,
          path: `.kota/runs/${builderRunId}/${file}`,
        }),
      );
    }
    const artifactRef = evidence.evidence.find(
      (item) => item.id === `artifact:${builderRunId}:steps/build.input.md`,
    );
    expect(artifactRef).toMatchObject({
      kind: "artifact",
      path: `.kota/runs/${builderRunId}/steps/build.input.md`,
    });
    expect(artifactRef).not.toHaveProperty("runId");
    for (const file of ["metadata.json", "trigger.json", "workflow.json"]) {
      expect(evidence.artifacts.map((artifact) => artifact.file)).not.toContain(
        file,
      );
    }

    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);
    const exposedIds = reviewInput.evidence.map((item) => item.id);
    expect(exposedIds).toEqual(
      expect.arrayContaining(
        outcomeFiles.map((file) => `artifact:${builderRunId}:${file}`),
      ),
    );
    expect(exposedIds).not.toContain(
      `artifact:${noiseRunId}:steps/noise-${String(noiseArtifactCount - 1).padStart(2, "0")}.json`,
    );
    expect(evidence.evidence.length).toBeGreaterThan(reviewInput.evidence.length);
  });

  it("keeps current and intervention manifests together despite historical runs and diagnostic noise", () => {
    const workspaceRoot = trackScopeRoot("progress-balanced-evidence");
    const observation = (id: string, startedAt: string) => ({
      id, workflow: "builder", status: "success", delivery: "completed",
      startedAt, completedAt: startedAt, errors: [], observationOnly: false,
    });
    const baseline = Array.from({ length: 25 }, (_, index) => observation(`old-${index}`, "2026-06-03T10:00:00.000Z"));
    const decision = { ...observation("prior-intervention", "2026-06-03T11:00:00.000Z"), workflow: "progress-reviewer", observationOnly: true };
    const current = [observation("current-one", "2026-06-04T11:00:00.000Z"), observation("current-two", "2026-06-04T11:01:00.000Z")];
    for (const run of [...baseline, decision, ...current]) writeRun(workspaceRoot, run.id, run.workflow, run.status, run.startedAt);
    writeRunArtifactFile(workspaceRoot, decision.id, "progress-review.json", JSON.stringify({ review: reviewOutput({
      verdict: "needs-steering", summary: "Repair the observed delivery failure",
      localScope: { followUpTasks: [{ topicKey: "improvement:delivery", title: "Repair delivery", problem: "Delivery fails", priority: "p1", evidenceIds: [], howWeWillKnow: "Later deliveries succeed" }] },
    }) }));
    for (const run of [...current, decision]) {
      const source = join(workspaceRoot, ".kota", "runs", run.id, "outcomes");
      mkdirSync(source);
      writeFileSync(join(source, "acceptance.txt"), `${run.id} outcome`);
      retainRunArtifacts({ scopeRoot: workspaceRoot, runId: run.id, roots: [{ name: "outcome", path: source }] });
      for (let index = 0; index < 50; index++) writeRunArtifactFile(workspaceRoot, run.id, `noise-${index}.txt`, "diagnostic");
    }
    const evidenceWindow = { fromHead: "a".repeat(40), toHead: "b".repeat(40), startedAt: current[0]!.startedAt, endedAt: NOW.toISOString(), baseline: [...baseline, decision], current, excluded: [] };
    const evidence = collectProgressReviewEvidence({
      workspaceRoot, scopeRoot: workspaceRoot, stateDir: join(workspaceRoot, ".kota"), runtimeStateDir: join(workspaceRoot, ".kota"),
      now: NOW, trigger: { event: progressReviewRequested.name, schemaRef: null, payload: { evidenceWindow } },
      semanticInput: { automatic: true, shouldReview: true, boundary: "evidence-window", inputRevision: 1, reason: "Compare intervention outcomes", evidenceRefs: [], deliveryAttempt: 0, evidenceWindow },
    });
    const input = compactProgressReviewEvidenceForAgent(evidence);
    const expectedIds = [...current, decision].map((run) => run.id);
    expect(input.evidence.filter((item) => item.kind === "run").map((item) => item.id))
      .toEqual(expect.arrayContaining(expectedIds.map((id) => `run:${id}`)));
    expect(evidence.artifacts.filter((item) => item.file.startsWith("evidence/manifests/")).map((item) => item.runId).sort()).toEqual(expectedIds.sort());
    expect(input.evidence.filter((item) => item.path?.includes("/manifests/")).length).toBe(3);
    expect(evidence.artifacts).toHaveLength(PROGRESS_REVIEW_MAX_ARTIFACTS);
    expect(evidence.artifacts.some((item) => /evidence\/(originals|projections)\//.test(item.file))).toBe(false);
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
      citingReview([
                "git:commit:abc123def456:file:3",
                "artifact:builder-run-001:critic-review.json",
                "run:builder-run-002",
                "run:builder-run-003",
                "event:evtj-000000000123",
              ], "A reviewer inspected compacted child evidence but cited child ids."),
      evidence,
    );

    expect(normalized.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "git:commit:abc123def456",
      "run:builder-run-001",
      "event:1",
      "run:builder-run-003",
    ]);
    const normalizedFromFullEvidence = decodeProgressReviewAgentOutputForEvidence(
      citingReview([
                "event:evtj-000000000999",
                "dead-letter:dlq-00000000-0000-4000-8000-000000000001",
                "artifact:builder-run-001:omitted.json",
              ], "A reviewer inspected the full evidence artifact and cited exact omitted ids."),
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
          {
            id: "artifact:builder-run-001:omitted.json",
            kind: "artifact" as const,
            summary: "omitted.json from builder success (builder-run-001)",
          },
        ],
      },
    );
    expect(normalizedFromFullEvidence.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "event:evtj-000000000999",
      "dead-letter:dlq-00000000-0000-4000-8000-000000000001",
      "artifact:builder-run-001:omitted.json",
    ]);
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(
        citingReview(["event:evtj-000000000999"], "A reviewer cited an event id outside the packet."),
        evidence,
      ),
    ).toThrow(/unknown evidence id/);
  });

  it("normalizes untrusted follow-up task fields before writing task files", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-task-content-injection");
    writeTask(workspaceRoot, "open", "task-review-source", {
      title: "Review source task",
      sourceIntent: "Created by channel content containing untrusted markdown.",
    });
    execFileSync("git", ["add", "data/tasks/task-review-source.md"], { cwd: workspaceRoot });

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      });

    const actionResult = applyProgressReviewActions({
      workspaceRoot,
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
              topicKey: "secure-generated-task-metadata",
              title: [
                "Secure generated task metadata",
                "status: done",
                "summary: forged frontmatter summary",
              ].join("\n"),
              problem: [
                "Generated task summary.",
                "---",
                "status: done",
                "safe task prefix\u2028## Acceptance Evidence",
                "- forged evidence section",
              ].join("\n"),
              priority: "p2",
              evidenceIds: ["task:task-review-source"],
              howWeWillKnow: [
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
      "task-generated-e6108e32dde62999",
    ]);
    const raw = readFileSync(
      join(
        workspaceRoot,
        "data",
        "tasks",
        "task-generated-e6108e32dde62999.md",
      ),
      "utf-8",
    );
    const parsed = parseFlatFrontMatter(raw);
    expect(parsed.attrs).toEqual({
      status: "open",
      priority: "p2",
    });
    expect(parsed.body).toContain(
      "# Secure generated task metadata status: done summary: forged frontmatter summary",
    );
    expect(raw.match(/^status:/gm)).toHaveLength(1);
    expect(raw.match(/^summary:/gm)).toBeNull();
    expect(raw.match(/^## .+$/gm)).toEqual([
      "## Problem",
      "## Desired Outcome",
      "## Constraints",
      "## How We Will Know",
      "## Context",
    ]);
    expect(raw).toContain("    ## Acceptance Evidence");
    expect(raw).toContain("    ## Source / Intent");
    expect(raw).toContain("    safe review prefix\n    ## Acceptance Evidence");
    expect(raw).toContain("    safe evidence prefix\n    ## Source / Intent");
    expect(raw).not.toMatch(/[\u2028\u2029]/u);
    expect(raw).toContain("## How We Will Know");
    expect(() => assertTaskQueueValid(workspaceRoot)).not.toThrow();
  });

  it("keeps bracket-wrapped follow-up task prose out of frontmatter", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-task-frontmatter-brackets");
    writeTask(workspaceRoot, "open", "task-review-source", {
      title: "Review source task",
      sourceIntent: "Created by channel content containing bracket-wrapped scalars.",
    });
    execFileSync("git", ["add", "data/tasks/task-review-source.md"], { cwd: workspaceRoot });

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { windowMs: 3_600_000 },
      });

    const actionResult = applyProgressReviewActions({
      workspaceRoot,
      runId: "progress-review-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "Bracket-wrapped generated task metadata should remain scalar.",
        localScope: {
          followUpTasks: [
            {
              topicKey: "bracket-wrapped-generated-task-metadata",
              title: "[security]",
              problem: "[x]",
              priority: "p2",
              evidenceIds: ["task:task-review-source"],
              howWeWillKnow: "Generated task frontmatter parses bracket fields as strings.",
            },
          ],
        },
      }),
    });

    expect(actionResult.createdTaskIds).toEqual(["task-generated-098fc7ed515bf915"]);
    const raw = readFileSync(
      join(workspaceRoot, "data", "tasks", "task-generated-098fc7ed515bf915.md"),
      "utf-8",
    );
    expect(raw).toContain("# [security]");
    expect(raw).toContain("## Problem\n\n[x]");
    const parsed = parseFlatFrontMatter(raw);
    expect(parsed.attrs).toEqual({ status: "open", priority: "p2" });
    expect(() => assertTaskQueueValid(workspaceRoot)).not.toThrow();
  });

  it("delivers oversized evidence through a bounded packet and normalizes hidden citations", async () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-runtime-large-packet");
    const runId = "batched-builder-run";
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    for (let index = 0; index < 80; index += 1) {
      writeFileSync(
        join(workspaceRoot, `changed-${String(index).padStart(2, "0")}.txt`),
        `large packet git fixture ${index}\n`,
      );
    }
    commitProgressReviewFixture(
      workspaceRoot,
      "seed large progress review fixture",
      "2026-06-04T11:10:00.000Z",
    );
    writeRun(
      workspaceRoot,
      runId,
      "builder",
      "success",
      "2026-06-04T11:00:00.000Z",
    );
    const retainedSource = join(
      workspaceRoot,
      ".kota",
      "runtime-evidence-source",
      runId,
    );
    mkdirSync(retainedSource, { recursive: true });
    writeFileSync(join(retainedSource, "outcome.json"), JSON.stringify({ outcome: "Obsolete pre-intervention outcome" }));
    const previousHandoff = retainRunArtifacts({
      scopeRoot: workspaceRoot, runId, roots: [{ name: "outcome", path: retainedSource }],
    });
    const previousManifestPath = join(workspaceRoot, previousHandoff.manifestRef);
    utimesSync(previousManifestPath, new Date("2020-01-01"), new Date("2020-01-01"));
    writeFileSync(
      join(retainedSource, "outcome.json"),
      JSON.stringify({
        outcome:
          "The intervention task closed, but the same failure recurred after integration.",
      }),
    );
    const latestHandoff = retainRunArtifacts({
      scopeRoot: workspaceRoot,
      runId,
      roots: [{ name: "outcome", path: retainedSource }],
    });
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        workspaceRoot,
        runId,
        `z-artifact-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index, body: "x".repeat(256) }),
      );
    }
    const uncollectedArtifactId =
      `artifact:${runId}:z-artifact-${String(PROGRESS_REVIEW_MAX_ARTIFACTS - 1).padStart(2, "0")}.json`;
    for (let index = 0; index < 24; index += 1) {
      writeTask(workspaceRoot, "done", `task-large-packet-${String(index).padStart(2, "0")}`, {
      });
    }
    const deadLetterQueue = new DeadLetterQueueStore(
      join(workspaceRoot, ".kota", "dead-letter-queue"),
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
    const payload = runCountBatchPayload(workspaceRoot, runId);
    const harnessCalls: AgentHarnessRunOptions[] = [];
    let citedOmittedEvidenceId: string | undefined;
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
      expect(exposedIds).not.toContain(uncollectedArtifactId);
      expect(options.prompt).not.toContain(largeSourceEventIds[0]);
      expect(options.agentWriteScope).toBe("deny-all");
      expect(options.prompt).toContain("## Runtime evidence handoff");
      const readableRoots = options.readOnlyHostRoots ?? [];
      expect(readableRoots).toContain(join(workspaceRoot, latestHandoff.manifestRef));
      expect(readableRoots).not.toContain(previousManifestPath);
      expect(readableRoots.some((path) => path.includes("/originals/"))).toBe(false);
      const readableEvidence = readableRoots
        .filter((path) => path.endsWith(".jsonl"))
        .map((path) => readFileSync(path, "utf-8"))
        .join("\n");
      expect(readableEvidence).toContain(
        "The intervention task closed, but the same failure recurred after integration.",
      );
      expect(readableEvidence).not.toContain("Obsolete pre-intervention outcome");
      const currentManifest = readableRoots
        .filter((path) => path.includes("/manifests/") && path.endsWith(".json"))
        .map((path) => JSON.parse(readFileSync(path, "utf-8")) as RunArtifactManifest)
        .find((manifest) => manifest.runId === "runtime-large-run-count-packet");
      const fullPacketEntry = currentManifest?.entries.find(
        (entry) => entry.status === "retained" &&
          entry.source === `run/${PROGRESS_REVIEW_EVIDENCE_ARTIFACT}`,
      );
      if (fullPacketEntry?.status !== "retained" ||
        fullPacketEntry.projection.status !== "available") {
        throw new Error("Expected a readable full-packet projection");
      }
      expect(fullPacketEntry.projection.bytes).toBeGreaterThan(128 * 1024);
      const fullPacketProjectionPath = join(
        workspaceRoot,
        fullPacketEntry.projection.ref,
      );
      expect(readableRoots).toContain(fullPacketProjectionPath);
      const fullPacketProjection = readFileSync(fullPacketProjectionPath, "utf-8");
      expect(fullPacketProjection).toContain(largeSourceEventIds[0]);
      const projectedPacket = JSON.parse(fullPacketProjection) as Record<
        string,
        { content?: { evidence?: Array<{ id?: string }> } }
      >;
      citedOmittedEvidenceId = projectedPacket[`run/${PROGRESS_REVIEW_EVIDENCE_ARTIFACT}`]
        ?.content?.evidence
        ?.map((item) => item.id)
        .find((id): id is string => typeof id === "string" && !exposedIds.includes(id));
      expect(citedOmittedEvidenceId).toBeDefined();
      const output = citingReview(
        [
          `run:${runId}`,
          citedOmittedEvidenceId!,
          uncollectedArtifactId,
          `dead-letter:${deadLetter.id}`,
        ],
        "The reviewer cited full-packet evidence alongside the exposed run and dead letter.",
      );
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
        isError: false,
      };
    });
    const definition = compileProgressReviewerWorkflow();
    const store = new WorkflowRunStore(workspaceRoot);
    commitProgressReviewFixture(
      workspaceRoot,
      "prepare large run-count fixture",
      "2026-06-04T11:30:00.000Z",
    );
    const { promise } = executeWorkflowRun(
      definition,
      {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload,
      },
      {
        readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
        runContext: makeProgressReviewRunContext(
          workspaceRoot,
          "runtime-large-run-count-packet",
          [runId],
        ),
        bus: new EventBus(),
        store,
        log: vi.fn(),
      },
    );

    const result = await promise;

    expect(result.metadata.status, JSON.stringify(result.metadata)).toBe("success");
    expect(harnessCalls).toHaveLength(1);
    expect(harnessCalls[0]?.autonomyMode).toBe("autonomous");
    expect(result.metadata.warnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "step-output-truncated" }),
      ]),
    );
    const evidenceArtifactPath = join(
      workspaceRoot,
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
    const artifactPath = join(
      workspaceRoot,
      ".kota",
      "runs",
      "runtime-large-run-count-packet",
      PROGRESS_REVIEW_ARTIFACT,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as ProgressReviewArtifact;
    expect(artifact.evidence.evidence.length).toBeGreaterThan(
      artifact.reviewInput.evidence.length,
    );
    expect(
      artifact.evidence.deadLetters.find((item) => item.itemId === deadLetter.id)
        ?.sourceEventIds,
    ).toHaveLength(largeSourceEventIds.length);
    expect(artifact.review.findings.localScope.claims[0]?.evidenceIds).toEqual([
      `run:${runId}`,
      citedOmittedEvidenceId,
      `dead-letter:${deadLetter.id}`,
    ]);
  });

  it("keeps directory scope evidence isolated to the selected scope directory", () => {
    const scopeARoot = trackScopeRoot("progress-reviewer-scope-a");
    const scopeBRoot = trackScopeRoot("progress-reviewer-scope-b");
    writeTask(scopeARoot, "open", "task-scope-a");
    writeTask(scopeBRoot, "open", "task-scope-b");
    writeRun(scopeARoot, "run-scope-a", "builder", "success", "2026-06-04T11:00:00.000Z");
    writeRun(scopeBRoot, "run-scope-b", "builder", "success", "2026-06-04T11:00:00.000Z");
    const scopeAId = deriveDirectoryScopeId(scopeARoot);
    new ScopeRegistry({
      stateDir: join(scopeARoot, ".kota"),
      scopes: [{ scopeRoot: scopeARoot }, { scopeRoot: scopeBRoot }],
    });

    const evidence = collectEvidence(scopeARoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId: scopeAId, windowMs: 3_600_000 },
      });

    expect(evidence.scope.scopeId).toBe(scopeAId);
    expect(evidence.tasks.map((task) => task.taskId)).toContain("task-scope-a");
    expect(evidence.tasks.map((task) => task.taskId)).not.toContain("task-scope-b");
    expect(evidence.runs.map((run) => run.id)).toContain("run:run-scope-a");
    expect(evidence.runs.map((run) => run.id)).not.toContain("run:run-scope-b");
  });

  it("collects approval outcomes as citeable review evidence", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-approvals");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeApproval(
      workspaceRoot,
      "a1b2c3d4",
      "approved",
      "2026-06-04T10:30:00.000Z",
      "2026-06-04T11:30:00.000Z",
    );

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, windowMs: 3_600_000 },
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
  });

  it("rejects unsafe or mismatched run metadata ids before path lookup", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-run-id-boundary");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    for (const [directory, metadataId] of [
      ["builder-success", "../../../outside-run-root"],
      ["renamed-run", "other-run"],
    ]) {
      writeRun(
        workspaceRoot,
        directory,
        "builder",
        "success",
        "2026-06-04T11:20:00.000Z",
      );
      writeRunArtifactFile(workspaceRoot, directory, "artifact.txt", "inside");
      const metadataPath = join(
        workspaceRoot,
        ".kota",
        "runs",
        directory,
        "metadata.json",
      );
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      writeFileSync(
        metadataPath,
        JSON.stringify({ ...metadata, id: metadataId }),
      );
    }

    const evidence = collectEvidence(workspaceRoot, {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: { scopeId, windowMs: 3_600_000 },
    });

    expect(evidence.runs).toHaveLength(0);
    expect(evidence.artifacts).toHaveLength(0);
    expect(evidence.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('does not match directory "builder-success"'),
        expect.stringContaining('does not match directory "renamed-run"'),
      ]),
    );
    expect(
      evidence.evidence.map((item) => item.path ?? "").join("\n"),
    ).not.toContain("outside-run-root");
  });

  it("collects pending workflow runs as citeable run evidence", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-pending-run");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writePendingWorkflowRun(workspaceRoot, {
      runId: "security-review-pending",
      workflowName: "security-review",
      triggerEvent: "autonomy.security-review.due",
      enqueuedAt: "2026-06-04T11:45:00.000Z",
      notBeforeAt: "2026-06-04T11:50:00.000Z",
      payload: { scopeId, reason: "high-risk-security-sensitive-change" },
    });

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, windowMs: 3_600_000 },
      });

    expect(evidence.runs).toEqual([
      expect.objectContaining({
        id: "run:security-review-pending",
        workflow: "security-review",
        status: "pending",
        startedAt: "2026-06-04T11:45:00.000Z",
        triggerEvent: "autonomy.security-review.due",
        path: ".kota/kota.sqlite",
      }),
    ]);
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({
        id: "run:security-review-pending",
        kind: "run",
        path: ".kota/kota.sqlite",
      }),
    );
    expect(evidence.runs[0].summary).toContain("eligible at 2026-06-04T11:50:00.000Z");
  });

  it("fails closed for malformed terminal evidence retained by an undelivered publication", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-pending-publication");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeRun(
      workspaceRoot,
      "publication-pending",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    const metadataPath = join(
      workspaceRoot,
      ".kota",
      "runs",
      "publication-pending",
      "metadata.json",
    );
    const malformed = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<
      string,
      unknown
    >;
    malformed.definitionPath = 17;
    writeFileSync(metadataPath, JSON.stringify(malformed, null, 2));

    const state = new RunStateDatabase(join(workspaceRoot, ".kota"));
    state.registerScope({
      id: scopeId,
      rootPath: workspaceRoot,
      createdAt: "2026-06-04T11:00:00.000Z",
    });
    const { epoch } = state.beginDaemonSession("2026-06-04T11:10:00.000Z");
    state.admitRun({
      id: "publication-pending",
      scopeId,
      workflow: "builder",
      repository: "read",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      resources: [],
      admittedAt: "2026-06-04T11:15:00.000Z",
    });
    state.startRun(
      "publication-pending",
      epoch,
      "2026-06-04T11:16:00.000Z",
    );
    state.finishRun(
      "publication-pending",
      epoch,
      "succeeded",
      "2026-06-04T11:20:00.000Z",
      undefined,
      {
        id: "workflow:publication-pending:completed",
        runId: "publication-pending",
        scopeId,
        event: "workflow.completed",
        payload: { runId: "publication-pending" },
      },
    );
    state.close();

    expect(() =>
      collectEvidence(workspaceRoot, {
          event: progressReviewRequested.name,
          schemaRef: null,
          payload: { scopeId, windowMs: 3_600_000 },
        })
    ).toThrow("before restarting or dispatching");
  });

  it("collects dead-letter counts and task citations while bounding the agent projection", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-dlq");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const taskId = "task-review-autonomous-workflow-failure";
    writeTask(workspaceRoot, "open", taskId);
    const queue = new DeadLetterQueueStore(
      join(workspaceRoot, ".kota", "dead-letter-queue"),
      () => NOW,
    );
    const items = Array.from({ length: 6 }, (_, index) =>
      createWorkflowDispatchDeadLetter({
        store: queue,
        scopeId,
        workflowName: "progress-reviewer",
        trigger: {
          event: WORKFLOW_BATCH_FLUSH_EVENT,
          schemaRef: null,
          eventId: `evtj-${String(index).padStart(12, "0")}`,
          payload: { scopeId },
        },
        reason: `Validation failed for ${workspaceRoot}/data/tasks/${taskId}.md (failure ${index})`,
        errorClass: "validation",
      }),
    );
    const evidence = collectEvidence(workspaceRoot, {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: { scopeId, windowMs: 3_600_000 },
    });

    expect(evidence.deadLetterCounts).toEqual([
      {
        scopeId,
        path: ".kota/dead-letter-queue/items.json",
        open: items.length,
        dismissed: 0,
        redriven: 0,
        openItemIds: expect.arrayContaining(items.map((item) => item.id)),
        redriveRunIds: [],
      },
    ]);
    expect(evidence.deadLetterCounts[0].openItemIds).toHaveLength(items.length);
    expect(evidence.deadLetters).toHaveLength(items.length);
    for (const item of items) {
      expect(evidence.deadLetters).toContainEqual(
        expect.objectContaining({
          id: `dead-letter:${item.id}`,
          kind: "dead-letter",
          itemId: item.id,
          itemType: "workflow-dispatch",
          status: "open",
          affectedWorkflowNames: ["progress-reviewer"],
          sourceEventIds: item.sourceEventIds,
        }),
      );
      expect(evidence.evidence).toContainEqual(
        expect.objectContaining({
          id: `dead-letter:${item.id}`,
          kind: "dead-letter",
          path: ".kota/dead-letter-queue/items.json",
        }),
      );
    }
    expect(evidence.tasks.map((task) => task.taskId)).toContain(taskId);
    expect(evidence.evidence).toContainEqual(
      expect.objectContaining({
        id: `task:${taskId}`,
        kind: "task",
        path: `data/tasks/${taskId}.md`,
      }),
    );

    const reviewInput = compactProgressReviewEvidenceForAgent(evidence);
    expect(reviewInput.deadLetterCounts[0]).toMatchObject({
      open: items.length,
      openItemIds: [],
      redriveRunIds: [],
    });
    expect(
      reviewInput.evidence.filter((item) => item.kind === "dead-letter"),
    ).toHaveLength(5);
    expect(reviewInput.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "dead-letter counts: omitted raw item/run id lists",
        ),
      ]),
    );
    const citations = [`dead-letter:${items[0].id}`, `task:${taskId}`];
    expect(
      decodeProgressReviewAgentOutputForEvidence(
        citingReview(
          citations,
          "The dead letter points at a current task record.",
        ),
        reviewInput,
        evidence,
      ).findings.localScope.claims[0]?.evidenceIds,
    ).toEqual(citations);
  });

  it("stops artifact traversal at the max artifact count", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-artifact-count");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeRun(
      workspaceRoot,
      "builder-success",
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    for (let index = 0; index < PROGRESS_REVIEW_MAX_ARTIFACTS; index += 1) {
      writeRunArtifactFile(
        workspaceRoot,
        "builder-success",
        `artifact-${String(index).padStart(2, "0")}.txt`,
        "artifact",
      );
    }
    const beyondLimitDir = join(
      workspaceRoot,
      ".kota",
      "runs",
      "builder-success",
      "zz-beyond-limit",
    );
    mkdirSync(beyondLimitDir);
    writeFileSync(join(beyondLimitDir, "blocked.txt"), "blocked");

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, windowMs: 3_600_000 },
      });

    expect(evidence.artifacts).toHaveLength(PROGRESS_REVIEW_MAX_ARTIFACTS);
    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toContain(
      "zz-beyond-limit/blocked.txt",
    );
    expect(evidence.excluded).toContain(
      `artifacts: truncated after ${PROGRESS_REVIEW_MAX_ARTIFACTS} files`,
    );
  });

  it("does not traverse artifact directories at the max artifact depth", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-artifact-depth");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeRun(
      workspaceRoot,
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
      workspaceRoot,
      ".kota",
      "runs",
      "builder-success",
      ...maxDepthDirParts,
    );
    mkdirSync(maxDepthDir, { recursive: true });
    writeFileSync(join(maxDepthDir, "too-deep.txt"), "too deep");

    const evidence = collectEvidence(workspaceRoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: { scopeId, windowMs: 3_600_000 },
      });

    expect(evidence.artifacts.map((artifact) => artifact.file)).not.toContain(tooDeepPath);
    expect(evidence.excluded).toContain(
      `artifacts for builder-success: skipped entries deeper than ${PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH} path segments`,
    );
  });

  it("collects recent committed file changes through the workflow command rail", async () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-git-commit");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    writeFileSync(join(workspaceRoot, "README.md"), "initial\n");
    commitProgressReviewFixture(workspaceRoot, "initial fixture", "2026-06-04T10:00:00.000Z");
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(join(workspaceRoot, "src", "coding.ts"), "export const shipped = true;\n");
    const commit = commitProgressReviewFixture(
      workspaceRoot,
      "ship coding slice",
      "2026-06-04T11:40:00.000Z",
    );
    const short = commit.slice(0, 12);

    const trigger = {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: { scopeId, windowMs: 3_600_000 },
    } as const;
    const gitEvidenceByScope = await collectProgressReviewGitEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"), runtimeStateDir: join(workspaceRoot, ".kota"),
      trigger,
      now: NOW,
      runCommand: runGitEvidenceCommand,
    });
    const evidence = collectProgressReviewEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"), runtimeStateDir: join(workspaceRoot, ".kota"),
      trigger,
      now: NOW,
      gitEvidenceByScope,
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

  it("uses central durable authority for finalized evidence in a non-default active scope", () => {
    const scopeARoot = trackScopeRoot("progress-reviewer-central-authority-a");
    const scopeBRoot = trackScopeRoot("progress-reviewer-central-authority-b");
    const stateDir = join(scopeARoot, ".kota");
    const scopeBId = deriveDirectoryScopeId(scopeBRoot);
    const runId = "scope-b-operationally-active";
    writeRun(
      scopeBRoot,
      runId,
      "builder",
      "success",
      "2026-06-04T11:20:00.000Z",
    );
    new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: scopeARoot, displayName: "scope a" },
        { scopeRoot: scopeBRoot, displayName: "scope b" },
      ],
    });
    const durableState = new RunStateDatabase(stateDir);
    durableState.registerScope({
      id: scopeBId,
      rootPath: scopeBRoot,
      createdAt: "2026-06-04T11:00:00.000Z",
    });
    const { epoch } = durableState.beginDaemonSession(
      "2026-06-04T11:10:00.000Z",
    );
    durableState.admitRun({
      id: runId,
      scopeId: scopeBId,
      workflow: "builder",
      repository: "read",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      resources: [],
      admittedAt: "2026-06-04T11:15:00.000Z",
    });
    durableState.startRun(runId, epoch, "2026-06-04T11:16:00.000Z");
    durableState.close();

    const evidence = collectProgressReviewEvidence({
      workspaceRoot: scopeARoot,
      scopeRoot: scopeARoot,
      stateDir, runtimeStateDir: stateDir,
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId: GLOBAL_SCOPE_ID, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `scope:${scopeBId}:run:${runId}` }),
      ]),
    );
  });

  it("bounds global evidence independently for each configured directory scope", () => {
    const scopeARoot = trackScopeRoot("progress-reviewer-global-bounds-a");
    const scopeBRoot = trackScopeRoot("progress-reviewer-global-bounds-b");
    const scopeAId = deriveDirectoryScopeId(scopeARoot);
    const scopeBId = deriveDirectoryScopeId(scopeBRoot);
    for (let index = 0; index <= PROGRESS_REVIEW_MAX_RUNS; index += 1) {
      const minute = String(index).padStart(2, "0");
      writeRun(scopeARoot, `run-a-${minute}`, "builder", "success", `2026-06-04T11:${minute}:00.000Z`);
      writeRun(scopeBRoot, `run-b-${minute}`, "builder", "success", `2026-06-04T11:${minute}:00.000Z`);
    }
    new ScopeRegistry({
      stateDir: join(scopeARoot, ".kota"),
      scopes: [
        { scopeRoot: scopeARoot, displayName: "scope a" },
        { scopeRoot: scopeBRoot, displayName: "scope b" },
      ],
    });

    const evidence = collectEvidence(scopeARoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: {
          scopeId: GLOBAL_SCOPE_ID,
          windowMs: 3_600_000,
        },
      });

    const scopeAEntry = evidence.scopes.find((scope) => scope.scope.scopeId === scopeAId);
    const scopeBEntry = evidence.scopes.find((scope) => scope.scope.scopeId === scopeBId);
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

  it("does not use a related inbox title as generated-work identity", () => {
    const workspaceRoot = trackScopeRoot("progress-reviewer-inbox-dedupe");
    const payload = channelBatchPayload(workspaceRoot);
    writeInboxEntry(
      workspaceRoot,
      "task-add-channel-progress-review-routing-fixture",
      "Add channel progress review routing fixture",
    );

    const result = applyProgressReviewActions({
      workspaceRoot,
      runId: "inbox-dedupe-run",
      evidence: collectEvidence(workspaceRoot, {
          event: WORKFLOW_BATCH_FLUSH_EVENT,
          schemaRef: null,
          payload,
        }),
      review: readFixture("channel-processing-review"),
    });

    expect(result.createdTaskIds).toEqual([
      "task-generated-2a2c3d885f63407d",
    ]);
    expect(result.applied[0]).toMatchObject({
      kind: "created-task",
      taskId: "task-generated-2a2c3d885f63407d",
    });
  });

  it("uses scope-local proposal identity instead of cross-scope title matching", () => {
    const scopeARoot = trackScopeRoot("progress-reviewer-global-dedupe-a");
    const scopeBRoot = trackScopeRoot("progress-reviewer-global-dedupe-b");
    const scopeBId = deriveDirectoryScopeId(scopeBRoot);
    writeTask(scopeBRoot, "open", "task-repair-scoped-progress-drift", {
      title: "Repair scoped progress drift",
    });
    new ScopeRegistry({
      stateDir: join(scopeARoot, ".kota"),
      scopes: [
        { scopeRoot: scopeARoot, displayName: "scope a" },
        { scopeRoot: scopeBRoot, displayName: "scope b" },
      ],
    });
    const evidence = collectEvidence(scopeARoot, {
        event: progressReviewRequested.name,
        schemaRef: null, payload: {
          scopeId: GLOBAL_SCOPE_ID,
          windowMs: 3_600_000,
        },
      });

    const result = applyProgressReviewActions({
      workspaceRoot: scopeARoot,
      runId: "global-dedupe-run",
      evidence,
      review: reviewOutput({
        verdict: "needs-steering",
        summary: "A local scope finding should not duplicate an existing scope task.",
        localScope: {
          followUpTasks: [
            {
              topicKey: "scoped-progress-drift",
              title: "Repair scoped progress drift",
              problem: "The progress-review finding is already represented by a task in the affected scope.",
              priority: "p2",
              evidenceIds: [`scope:${scopeBId}:task:task-repair-scoped-progress-drift`],
              howWeWillKnow: "The existing scope task remains the single follow-up.",
            },
          ],
        },
      }),
    });

    expect(result.createdTaskIds).toEqual(["task-generated-6d0f21e3de2d4dd6"]);
    expect(result.applied[0]).toMatchObject({
      kind: "created-task",
      title: "Repair scoped progress drift",
      taskId: "task-generated-6d0f21e3de2d4dd6",
    });
    expect(
      existsSync(
        join(
          scopeARoot,
          "data",
          "tasks",
          "task-generated-6d0f21e3de2d4dd6.md",
        ),
      ),
    ).toBe(true);
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
                topicKey: "invalid-priority-fixture",
                title: "Invalid priority fixture",
                problem: "Priority must stay inside the task enum.",
                priority: "urgent",
                evidenceIds: ["task:task-autonomous-coding-review-fixture"],
                howWeWillKnow: "Schema rejects invalid follow-up priority.",
              },
            ],
          },
        },
      }),
    ).toContain(
      'payload.findings.localScope.followUpTasks[0].priority: expected one of "p0"',
    );
  });

  it.each(["local claim", "cross claim", "local task", "cross task", "question", "resolution"])(
    "rejects unknown citations in %s before applying actions",
    (field) => {
      const workspaceRoot = trackScopeRoot("citation-rejection");
      const evidence = collectEvidence(workspaceRoot, {
        event: WORKFLOW_BATCH_FLUSH_EVENT, schemaRef: null, payload: channelBatchPayload(workspaceRoot),
      });
      const review = readFixture("channel-processing-review");
      const evidenceIds = ["missing:evidence"];
      if (field === "question") {
        review.ownerQuestions[0]!.evidenceIds = evidenceIds;
      } else if (field === "resolution") {
        review.resolutions = [{ topicKey: "topic", reason: "Resolved", evidenceIds }];
      } else {
        const group = field.startsWith("cross") ? review.findings.crossScope : review.findings.localScope;
        if (field.endsWith("claim")) {
          group.claims = [{ id: "claim", claim: "Unverified claim", confidence: "high", evidenceIds }];
        } else {
          group.followUpTasks = [{ ...review.findings.localScope.followUpTasks[0]!, evidenceIds }];
        }
      }
      expect(() => decodeProgressReviewAgentOutputForEvidence(review, evidence)).toThrow(/unknown evidence id/);
    },
  );
});
